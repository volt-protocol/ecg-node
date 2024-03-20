import { readFileSync } from 'fs';
import { Auction, AuctionStatus, AuctionsFileStructure } from '../model/Auction';
import { DATA_DIR } from '../utils/Constants';
import { GetNodeConfig, GetProtocolData, ReadJSON, sleep } from '../utils/Utils';
import path from 'path';
import { AuctionHouse__factory, GatewayV1__factory, UniswapV2Router__factory } from '../contracts/types';
import { GetGatewayAddress, GetPSMAddress, GetUniswapV2RouterAddress, getTokenBySymbol } from '../config/Config';
import { ethers } from 'ethers';
import LendingTerm, { LendingTermsFileStructure } from '../model/LendingTerm';
import { norm } from '../utils/TokenUtils';
import { SendNotifications } from '../utils/Notifications';
import { GetWeb3Provider } from '../utils/Web3Helper';
import { FileMutex } from '../utils/FileMutex';
import { Log } from '../utils/Logger';

const RUN_EVERY_SEC = 15;

async function AuctionBidder() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'ECG_NODE_AUCTION_BIDDER';
    Log('starting');
    const auctionBidderConfig = GetNodeConfig().processors.AUCTION_BIDDER;

    const auctionsFilename = path.join(DATA_DIR, 'auctions.json');
    const termsFilename = path.join(DATA_DIR, 'terms.json');

    // wait for unlock just before reading data file
    await FileMutex.WaitForUnlock();
    const auctionFileData: AuctionsFileStructure = ReadJSON(auctionsFilename);
    const termFileData: LendingTermsFileStructure = ReadJSON(termsFilename);

    const rpcURL = process.env.RPC_URL;
    if (!rpcURL) {
      throw new Error('Cannot find RPC_URL in env');
    }
    if (!process.env.ETH_PRIVATE_KEY) {
      throw new Error('Cannot find ETH_PRIVATE_KEY in env');
    }

    const creditMultiplier = GetProtocolData().creditMultiplier;

    const auctionsToCheck = auctionFileData.auctions.filter((_) => _.status == AuctionStatus.ACTIVE);
    Log(`Will check ${auctionsToCheck.length} auctions`);

    for (const auction of auctionsToCheck) {
      const term = termFileData.terms.find((_) => _.termAddress == auction.lendingTermAddress);
      if (!term) {
        throw new Error(`Cannot find term ${auction.lendingTermAddress}`);
      }
      const web3Provider = GetWeb3Provider();
      const auctionHouseContract = AuctionHouse__factory.connect(auction.auctionHouseAddress, web3Provider);
      const bidDetail = await auctionHouseContract.getBidDetail(auction.loanId);
      if (bidDetail.creditAsked == 0n && auctionBidderConfig.enableForgive) {
        Log(`AuctionBidder[${auction.loanId}]: will forgive auction.`);
        await processForgive(auction, web3Provider);
        continue;
      }

      const estimatedProfit = await checkBidProfitability(term, bidDetail, web3Provider, creditMultiplier);
      if (estimatedProfit >= auctionBidderConfig.minProfitUsdc) {
        Log(`AuctionBidder[${auction.loanId}]: will bid on auction for estimated profit: ${estimatedProfit}`);
        await processBid(auction, term, web3Provider, auctionBidderConfig.minProfitUsdc, estimatedProfit);
        continue;
      }

      Log(`AuctionBidder[${auction.loanId}]: do not bid, profit too low: ${estimatedProfit}`);
    }

    await sleep(RUN_EVERY_SEC * 1000);
  }
}

async function checkBidProfitability(
  term: LendingTerm,
  bidDetail: { collateralReceived: bigint; creditAsked: bigint },
  web3Provider: ethers.JsonRpcProvider,
  creditMultiplier: bigint
): Promise<number> {
  const uniswapRouterContract = UniswapV2Router__factory.connect(GetUniswapV2RouterAddress(), web3Provider);

  // find the amount of USDC that can be obtain if selling bidDetail.collateralReceived
  const fromToken = term.collateralAddress;
  const USDCToken = getTokenBySymbol('USDC');
  const toToken = USDCToken.address;

  const amountsOut = await uniswapRouterContract.getAmountsOut(bidDetail.collateralReceived, [fromToken, toToken]);

  const amountUsdc = norm(amountsOut[1], USDCToken.decimals);
  const creditCostInUsdc = norm((bidDetail.creditAsked * creditMultiplier) / 10n ** 18n);

  Log(
    `checkBidProfitability: bidding cost: ${creditCostInUsdc} USDC, gains: ${amountUsdc} USDC. PnL: ${
      amountUsdc - creditCostInUsdc
    } USDC`
  );
  if (creditCostInUsdc > amountUsdc) {
    return 0;
  }

  const profitUsdc = amountUsdc - creditCostInUsdc;
  return profitUsdc;
}

async function processBid(
  auction: Auction,
  term: LendingTerm,
  web3Provider: ethers.JsonRpcProvider,
  minProfit: number,
  estimatedProfit: number
) {
  if (!process.env.ETH_PRIVATE_KEY) {
    throw new Error('Cannot find ETH_PRIVATE_KEY in env');
  }
  const signer = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, web3Provider);
  const gatewayContract = GatewayV1__factory.connect(GetGatewayAddress(), signer);
  const txReceipt = await gatewayContract.bidWithBalancerFlashLoan(
    auction.loanId,
    auction.lendingTermAddress,
    GetPSMAddress(),
    GetUniswapV2RouterAddress(),
    term.collateralAddress, // collateralTokenAddress
    getTokenBySymbol('USDC').address, // pegTokenAddress
    minProfit
  );
  await txReceipt.wait();
  if (term.termAddress.toLowerCase() != '0x427425372b643fc082328b70A0466302179260f5'.toLowerCase()) {
    await SendNotifications(
      'Auction Bidder',
      `Auction ${auction.loanId} fulfilled`,
      `Estimated USDC profit: ${estimatedProfit}`
    );
  }
}

async function processForgive(auction: Auction, web3Provider: ethers.JsonRpcProvider) {
  if (!process.env.ETH_PRIVATE_KEY) {
    throw new Error('Cannot find ETH_PRIVATE_KEY in env');
  }
  const signer = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, web3Provider);
  const auctionHouseContract = AuctionHouse__factory.connect(auction.auctionHouseAddress, signer);
  const txReceipt = await auctionHouseContract.forgive(auction.loanId);
  await txReceipt.wait();

  await SendNotifications('Auction Bidder', 'Forgave auction', auction.loanId);
}

AuctionBidder();
