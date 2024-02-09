import { readFileSync } from 'fs';
import { Auction, AuctionStatus, AuctionsFileStructure } from '../model/Auction';
import { DATA_DIR } from '../utils/Constants';
import { GetNodeConfig, sleep } from '../utils/Utils';
import path from 'path';
import {
  AuctionHouse__factory,
  ERC20__factory,
  GatewayV1__factory,
  ProfitManager__factory,
  SimplePSM__factory,
  UniswapV2Router__factory
} from '../contracts/types';
import {
  GetGatewayAddress,
  GetPSMAddress,
  GetProfitManagerAddress,
  GetUniswapV2RouterAddress,
  TOKENS,
  getTokenByAddress,
  getTokenBySymbol
} from '../config/Config';
import { ethers } from 'ethers';
import { GetAvgGasPrice } from '../utils/Web3Helper';
import LendingTerm, { LendingTermStatus, LendingTermsFileStructure } from '../model/LendingTerm';
import { norm } from '../utils/TokenUtils';

import ERC20ABI from '../contracts/abi/ERC20.json';
import UniswapV2RouterABI from '../contracts/abi/UniswapV2Router.json';
import PSMAbi from '../contracts/abi/SimplePSM.json';
import GatewayABI from '../contracts/abi/GatewayV1.json';

const RUN_EVERY_SEC = 15;

async function AuctionBidder() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'AUCTION_BIDDER';
    console.log('AuctionBidder: starting');
    const auctionBidderConfig = GetNodeConfig().processors.AUCTION_BIDDER;

    const auctionsFilename = path.join(DATA_DIR, 'auctions.json');
    const termsFilename = path.join(DATA_DIR, 'terms.json');
    const auctionFileData: AuctionsFileStructure = JSON.parse(readFileSync(auctionsFilename, 'utf-8'));
    const termFileData: LendingTermsFileStructure = JSON.parse(readFileSync(termsFilename, 'utf-8'));

    const rpcURL = process.env.RPC_URL;
    if (!rpcURL) {
      throw new Error('Cannot find RPC_URL in env');
    }

    const gasPrice = await GetAvgGasPrice(rpcURL);
    const web3Provider = new ethers.JsonRpcProvider(rpcURL);
    const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), web3Provider);
    const creditMultiplier = await profitManagerContract.creditMultiplier();

    const auctionsToCheck = auctionFileData.auctions.filter((_) => _.status == AuctionStatus.ACTIVE);
    console.log(`AuctionBidder: Will check ${auctionsToCheck.length} auctions`);

    for (const auction of auctionsToCheck) {
      const term = termFileData.terms.find((_) => _.termAddress == auction.lendingTermAddress);
      if (!term) {
        throw new Error(`Cannot find term ${auction.lendingTermAddress}`);
      }
      const auctionHouseContract = AuctionHouse__factory.connect(auction.auctionHouseAddress, web3Provider);
      const bidDetail = await auctionHouseContract.getBidDetail(auction.loanId);
      const profit = await checkBidProfitability(term, bidDetail, web3Provider, creditMultiplier);

      if (profit >= auctionBidderConfig.minProfitUsdc) {
        console.log(`AuctionBidder[${auction.loanId}]: will bid on auction for estimated profit: ${profit}`);
        await processBid(auction, term, bidDetail, web3Provider);
      }
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

  if (creditCostInUsdc > amountUsdc) {
    return 0;
  }

  const profitUsdc = amountUsdc - creditCostInUsdc;
  return profitUsdc;
}

async function processBid(
  auction: Auction,
  term: LendingTerm,
  bidDetail: { collateralReceived: bigint; creditAsked: bigint },
  web3Provider: ethers.JsonRpcProvider,
  creditMultiplier: bigint
) {
  // create a multicall via the gateway to flashloan USDC
  const calls = [];
  const flashloanAmountUsdc = (bidDetail.creditAsked * creditMultiplier) / 10n ** 30n + 1n;

  const gatewayInterface = GatewayV1__factory.createInterface();
  const ERC20Interface = ERC20__factory.createInterface();
  const PSMInterface = SimplePSM__factory.createInterface();
  const AuctionHouseInterface = AuctionHouse__factory.createInterface();
  const UniswapRouterInterface = UniswapV2Router__factory.createInterface();
  const USDCToken = getTokenBySymbol('USDC');
  const collateralToken = getTokenByAddress(term.collateralAddress);
  const CreditToken = getTokenBySymbol('gUSDC');

  // approve USDC from gateway=>psm
  calls.push(
    gatewayInterface.encodeFunctionData('callExternal', [
      USDCToken.address,
      ERC20Interface.encodeFunctionData('approve', [GetPSMAddress(), flashloanAmountUsdc])
    ])
  );

  // mint credit using flashloaned amount
  calls.push(
    gatewayInterface.encodeFunctionData('callExternal', [
      GetPSMAddress(),
      PSMInterface.encodeFunctionData('mint', [GetGatewayAddress(), flashloanAmountUsdc])
    ])
  );

  // approve credit from gateway => lending term
  calls.push(
    gatewayInterface.encodeFunctionData('callExternal', [
      CreditToken.address,
      ERC20Interface.encodeFunctionData('approve', [term.termAddress, bidDetail.creditAsked])
    ])
  );

  // bid on the loan
  calls.push(
    gatewayInterface.encodeFunctionData('callExternal', [
      auction.auctionHouseAddress,
      AuctionHouseInterface.encodeFunctionData('bid', [auction.loanId])
    ])
  );

  // approve collateral from gateway => uniswap router
  calls.push(
    gatewayInterface.encodeFunctionData('callExternal', [
      collateralToken.address,
      ERC20Interface.encodeFunctionData('approve', [GetUniswapV2RouterAddress(), bidDetail.collateralReceived])
    ])
  );

  // swap sDAI to USDC on uniswap
  calls.push(
    gatewayInterface.encodeFunctionData('callExternal', [
      GetUniswapV2RouterAddress(),
      UniswapRouterInterface.encodeFunctionData('swapExactTokensForTokens', [
        bidDetail.collateralReceived,
        flashloanAmountUsdc,
        [collateralToken.address, USDCToken.address],
        GetGatewayAddress(),
        Date.now() / 1000 + 120 // 120 sec deadline
      ])
    ])
  );
}

// AuctionBidder();

checkBidProfitability(
  {
    termAddress: '0x938998fca53D8BFD91BC1726D26238e9Eada596C',
    collateralAddress: '0x9F07498d9f4903B10dB57a3Bd1D91b6B64AEd61e',
    interestRate: '40000000000000000',
    borrowRatio: '1000000000000000000',
    maxDebtPerCollateralToken: '1000000000000000000',
    currentDebt: '21446144574656902252905',
    hardCap: '2000000000000000000000000',
    availableDebt: '1978553855425343097747095',
    openingFee: '0',
    minPartialRepayPercent: '0',
    maxDelayBetweenPartialRepay: 0,
    minBorrow: '100000000000000000000',
    status: LendingTermStatus.LIVE,
    label: 'sDAI-4%-1',
    collateralSymbol: 'sDAI',
    collateralDecimals: 18,
    permitAllowed: true,
    auctionHouseAddress: '0x912e76518b318c209eF7FF04D119967AcAe3569e'
  },
  {
    collateralReceived: 998n * 10n ** 18n,
    creditAsked: 1000n * 10n ** 18n
  },
  new ethers.JsonRpcProvider('https://sepolia.infura.io/v3/eb9a2c404eef43b891e4066a148f71dd'),
  10n ** 18n,
  20
);
