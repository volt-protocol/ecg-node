import { readFileSync } from 'fs';
import { Auction, AuctionStatus, AuctionsFileStructure } from '../model/Auction';
import { DATA_DIR } from '../utils/Constants';
import { GetNodeConfig, GetProtocolData, ReadJSON, sleep } from '../utils/Utils';
import path from 'path';
import { AuctionHouse__factory, GatewayV1__factory, UniswapV2Router__factory } from '../contracts/types';
import {
  GetGatewayAddress,
  GetPSMAddress,
  GetPegTokenAddress,
  GetUniswapV2RouterAddress,
  LoadConfiguration,
  getTokenByAddress,
  getTokenBySymbol
} from '../config/Config';
import { ethers } from 'ethers';
import LendingTerm, { LendingTermsFileStructure } from '../model/LendingTerm';
import { norm } from '../utils/TokenUtils';
import { SendNotifications } from '../utils/Notifications';
import { GetWeb3Provider } from '../utils/Web3Helper';
import { FileMutex } from '../utils/FileMutex';
import { Log } from '../utils/Logger';
import { BidderSwapMode } from '../model/NodeConfig';

const RUN_EVERY_SEC = 15;

async function AuctionBidder() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // load external config
    await LoadConfiguration();
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

      const { swapData, estimatedProfit, routerAddress } = await checkBidProfitability(
        auctionBidderConfig.swapMode,
        term,
        bidDetail,
        web3Provider,
        creditMultiplier
      );

      if (estimatedProfit >= auctionBidderConfig.minProfitPegToken) {
        Log(`AuctionBidder[${auction.loanId}]: will bid on auction for estimated profit: ${estimatedProfit}`);
        await processBid(
          auction,
          term,
          web3Provider,
          auctionBidderConfig.minProfitPegToken,
          routerAddress,
          swapData,
          estimatedProfit
        );
        continue;
      }

      Log(`AuctionBidder[${auction.loanId}]: do not bid, profit too low: ${estimatedProfit}`);
    }

    await sleep(RUN_EVERY_SEC * 1000);
  }
}

async function checkBidProfitability(
  swapMode: BidderSwapMode,
  term: LendingTerm,
  bidDetail: { collateralReceived: bigint; creditAsked: bigint },
  web3Provider: ethers.JsonRpcProvider,
  creditMultiplier: bigint
): Promise<{ swapData: string; estimatedProfit: number; routerAddress: string }> {
  switch (swapMode) {
    default:
    case BidderSwapMode.ONE_INCH:
    case BidderSwapMode.OPEN_OCEAN:
      throw new Error(`${swapMode} not implemeted`);
    case BidderSwapMode.UNISWAPV2: {
      return await checkBidProfitabilityUniswapV2(term, bidDetail, web3Provider, creditMultiplier);
    }
  }
}

async function checkBidProfitabilityUniswapV2(
  term: LendingTerm,
  bidDetail: { collateralReceived: bigint; creditAsked: bigint },
  web3Provider: ethers.JsonRpcProvider,
  creditMultiplier: bigint
): Promise<{ swapData: string; estimatedProfit: number; routerAddress: string }> {
  const uniswapRouterContract = UniswapV2Router__factory.connect(GetUniswapV2RouterAddress(), web3Provider);

  // find the amount of USDC that can be obtain if selling bidDetail.collateralReceived
  const fromToken = term.collateralAddress;
  const pegToken = getTokenByAddress(GetPegTokenAddress());
  const toToken = pegToken.address;

  const amountsOut = await uniswapRouterContract.getAmountsOut(bidDetail.collateralReceived, [fromToken, toToken]);

  const amountPegToken = norm(amountsOut[1], pegToken.decimals);
  const creditCostInPegToken = norm((bidDetail.creditAsked * creditMultiplier) / 10n ** 18n);

  Log(
    `checkBidProfitability: bidding cost: ${creditCostInPegToken} ${pegToken.symbol}, gains: ${amountPegToken} ${
      pegToken.symbol
    }. PnL: ${amountPegToken - creditCostInPegToken} ${pegToken.symbol}`
  );
  if (creditCostInPegToken > amountPegToken) {
    return { swapData: '', estimatedProfit: 0, routerAddress: '' };
  }

  const profitPegToken = amountPegToken - creditCostInPegToken;

  const swapData = uniswapRouterContract.interface.encodeFunctionData('swapExactTokensForTokens', [
    bidDetail.collateralReceived, // amountIn
    0n, // minAmountOut ==> no need because we'll check the minProfit in the gateway
    [fromToken, toToken], // path, collateral=>pegToken
    GetGatewayAddress(), // to gateway
    Math.round(Date.now() / 1000) + 120 // deadline in 2 minutes
  ]);
  return { swapData, estimatedProfit: profitPegToken, routerAddress: GetUniswapV2RouterAddress() };
}

async function processBid(
  auction: Auction,
  term: LendingTerm,
  web3Provider: ethers.JsonRpcProvider,
  minProfit: number,
  routerAddress: string, // either univ2, 1inch, openocean etc...
  swapData: string,
  estimatedProfit: number
) {
  if (!process.env.BIDDER_ETH_PRIVATE_KEY) {
    throw new Error('Cannot find BIDDER_ETH_PRIVATE_KEY in env');
  }
  const signer = new ethers.Wallet(process.env.BIDDER_ETH_PRIVATE_KEY, web3Provider);
  const gatewayContract = GatewayV1__factory.connect(GetGatewayAddress(), signer);
  const txReceipt = await gatewayContract.bidWithBalancerFlashLoan(
    auction.loanId,
    auction.lendingTermAddress,
    GetPSMAddress(),
    term.collateralAddress, // collateralTokenAddress
    GetPegTokenAddress(), // pegTokenAddress
    minProfit,
    routerAddress,
    swapData
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
  if (!process.env.BIDDER_ETH_PRIVATE_KEY) {
    throw new Error('Cannot find BIDDER_ETH_PRIVATE_KEY in env');
  }
  const signer = new ethers.Wallet(process.env.BIDDER_ETH_PRIVATE_KEY, web3Provider);
  const auctionHouseContract = AuctionHouse__factory.connect(auction.auctionHouseAddress, signer);
  const txReceipt = await auctionHouseContract.forgive(auction.loanId);
  await txReceipt.wait();

  await SendNotifications('Auction Bidder', 'Forgave auction', auction.loanId);
}

AuctionBidder();
