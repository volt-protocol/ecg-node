import { Auction, AuctionStatus, AuctionsFileStructure } from '../model/Auction';
import { BN_1e18, DATA_DIR, SWAP_MODE } from '../utils/Constants';
import { GetProtocolData, ReadJSON, sleep } from '../utils/Utils';
import path from 'path';
import { AuctionHouse__factory, GatewayV12Steps__factory } from '../contracts/types';
import {
  GetGatewayAddress2Steps,
  GetNodeConfig,
  GetPSMAddress,
  GetPegTokenAddress,
  getTokenByAddress,
  getTokenByAddressNoError,
  getTokenBySymbol
} from '../config/Config';
import { JsonRpcProvider, ethers } from 'ethers';
import LendingTerm, { LendingTermsFileStructure } from '../model/LendingTerm';
import { norm } from '../utils/TokenUtils';
import { SendNotifications } from '../utils/Notifications';
import { GetERC20Infos, GetWeb3Provider } from '../utils/Web3Helper';
import { Log, Warn } from '../utils/Logger';
import { BidderSwapMode } from '../model/NodeConfig';
import { HttpGet, HttpPost } from '../utils/HttpHelper';
import BigNumber from 'bignumber.js';
import { TokenConfig } from '../model/Config';
import PriceService from '../services/price/PriceService';
import SwapService from '../services/swap/SwapService';

const RUN_EVERY_SEC = 60;

let GATEWAY_ADDRESS = '';
let PEG_TOKEN: TokenConfig;

async function AuctionBidder() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'ECG_NODE_AUCTION_BIDDER';
    Log(`starting with swap mode: ${SWAP_MODE}`);
    const auctionBidderConfig = (await GetNodeConfig()).processors.AUCTION_BIDDER;

    const auctionsFilename = path.join(DATA_DIR, 'auctions.json');
    const termsFilename = path.join(DATA_DIR, 'terms.json');

    const auctionFileData: AuctionsFileStructure = ReadJSON(auctionsFilename);
    const termFileData: LendingTermsFileStructure = ReadJSON(termsFilename);

    const rpcURL = process.env.RPC_URL;
    if (!rpcURL) {
      throw new Error('Cannot find RPC_URL in env');
    }

    const creditMultiplier = GetProtocolData().creditMultiplier;

    const auctionsToCheck = auctionFileData.auctions.filter((_) => _.status == AuctionStatus.ACTIVE);
    Log(`Will check ${auctionsToCheck.length} auctions`);

    GATEWAY_ADDRESS = await GetGatewayAddress2Steps();
    for (const auction of auctionsToCheck) {
      const term = termFileData.terms.find((_) => _.termAddress == auction.lendingTermAddress);
      if (!term) {
        throw new Error(`Cannot find term ${auction.lendingTermAddress}`);
      }
      const web3Provider = GetWeb3Provider();

      const bidDetail = await getBidDetails(auction.auctionHouseAddress, web3Provider, auction.loanId);
      if (bidDetail.auctionEnded) {
        Log('Auction ended, will not try to bid');
        continue;
      }
      if (bidDetail.creditAsked == 0n && auctionBidderConfig.enableForgive) {
        Log(`AuctionBidder[${auction.loanId}]: will forgive auction.`);
        await processForgive(auction, web3Provider);
        continue;
      }

      PEG_TOKEN = await getTokenByAddress(await GetPegTokenAddress());
      const flashloanToken = PEG_TOKEN.flashloanToken ? await getTokenBySymbol(PEG_TOKEN.flashloanToken) : PEG_TOKEN;
      // 2 step swap
      const {
        estimatedProfitUsd,
        flashloanAmount,
        swapData,
        routerAddress,
        swapDataToFlashloanToken,
        routerAddressToFlashloanToken
      } = await checkBidProfitability(
        term.collateralAddress,
        bidDetail,
        web3Provider,
        creditMultiplier,
        flashloanToken
      );
      if (estimatedProfitUsd >= auctionBidderConfig.minProfitUsd) {
        Log(`AuctionBidder[${auction.loanId}]: will bid on auction for estimated profit: ${estimatedProfitUsd}`);
        await processBid(
          auction,
          term,
          web3Provider,
          auctionBidderConfig.minProfitUsd,
          flashloanToken,
          flashloanAmount,
          routerAddress,
          swapData,
          routerAddressToFlashloanToken,
          swapDataToFlashloanToken,
          estimatedProfitUsd
        );
        continue;
      }
      Log(
        `AuctionBidder[${auction.loanId}]: do not bid, profit too low: $${estimatedProfitUsd}. (min profit: $${auctionBidderConfig.minProfitUsd})`
      );
    }

    await sleep(RUN_EVERY_SEC * 1000);
  }
}

async function getBidDetails(
  auctionHouseAddress: string,
  web3Provider: JsonRpcProvider,
  loanId: string
): Promise<{ collateralReceived: bigint; creditAsked: bigint; auctionEnded: boolean }> {
  const auctionHouseContract = AuctionHouse__factory.connect(auctionHouseAddress, web3Provider);
  try {
    const bidDetail = await auctionHouseContract.getBidDetail(loanId);
    return {
      collateralReceived: bidDetail.collateralReceived,
      creditAsked: bidDetail.creditAsked,
      auctionEnded: false
    };
  } catch (e) {
    Log('getBidDetail exception:', e);
    return {
      collateralReceived: -1n,
      creditAsked: -1n,
      auctionEnded: true
    };
  }
}

async function checkBidProfitability(
  termCollateralAddress: string,
  bidDetail: { collateralReceived: bigint; creditAsked: bigint },
  web3Provider: ethers.JsonRpcProvider,
  creditMultiplier: bigint,
  flashloanToken: TokenConfig
): Promise<{
  estimatedProfitUsd: number;
  flashloanAmount: bigint;
  swapData: string;
  routerAddress: string;
  swapDataToFlashloanToken: string;
  routerAddressToFlashloanToken: string;
}> {
  let collateralToken = await getTokenByAddressNoError(termCollateralAddress);
  if (!collateralToken) {
    collateralToken = await GetERC20Infos(web3Provider, termCollateralAddress);
    Warn(
      `Token ${termCollateralAddress} not found in config. ERC20 infos: ${collateralToken.symbol} / ${collateralToken.decimals} decimals`
    );
  }

  const creditAskedInPegToken = (bidDetail.creditAsked * creditMultiplier) / BN_1e18;
  let flashloanAmountInFlashloanToken = creditAskedInPegToken;
  const flashloanToPegTokenSwapResults = {
    swapData: '0x',
    routerAddress: ethers.ZeroAddress,
    swapLabel: ''
  };

  if (flashloanToken.address != PEG_TOKEN.address) {
    // get the swap data to flashloan "flashloanToken" so that we can swap to pegToken
    const { swapData, routerAddress, flashloanAmount, swapLabel } = await getKyberSwapDataForPegTokenAmount(
      PEG_TOKEN,
      flashloanToken,
      creditAskedInPegToken
    );
    flashloanToPegTokenSwapResults.swapData = swapData;
    flashloanToPegTokenSwapResults.routerAddress = routerAddress;
    flashloanToPegTokenSwapResults.swapLabel = swapLabel;
    flashloanAmountInFlashloanToken = flashloanAmount;
  }

  let getSwapFunction;
  // specific case for pendle, use pendle amm
  if (collateralToken.pendleConfiguration) {
    getSwapFunction = SwapService.GetSwapPendle;
  } else {
    switch (SWAP_MODE) {
      default:
        throw new Error(`${SWAP_MODE} not implemented`);
      case BidderSwapMode.ONE_INCH:
        getSwapFunction = SwapService.GetSwap1Inch;
        break;
      case BidderSwapMode.OPEN_OCEAN:
        getSwapFunction = SwapService.GetSwapOpenOcean;
        break;
      case BidderSwapMode.UNISWAPV2:
        getSwapFunction = SwapService.GetSwapUniv2;
        break;
    }
  }

  const collateralToFlashloanTokenSwapResults = await getSwapFunction(
    collateralToken,
    flashloanToken,
    bidDetail.collateralReceived,
    web3Provider,
    GATEWAY_ADDRESS
  );

  const amountFlashloanTokenReceivedUsd =
    norm(collateralToFlashloanTokenSwapResults.toTokenReceivedWei, flashloanToken.decimals) *
    (await PriceService.GetTokenPrice(flashloanToken.address));
  const creditCostUsd =
    norm((bidDetail.creditAsked * creditMultiplier) / 10n ** 18n) *
    (await PriceService.GetTokenPrice(PEG_TOKEN.address));

  const profitUsd = amountFlashloanTokenReceivedUsd - creditCostUsd;

  let msg = `Auction details (${norm(bidDetail.collateralReceived, collateralToken.decimals)} ${
    collateralToken.symbol
  } for ${norm(creditAskedInPegToken)} ${PEG_TOKEN.symbol})\n`;
  if (flashloanToken.address == PEG_TOKEN.address) {
    msg +=
      `Bid in 1 step via ${flashloanToken.symbol} flashloan\n` +
      `\t - Bid to receive ${norm(bidDetail.collateralReceived, collateralToken.decimals)} ${
        collateralToken.symbol
      }\n` +
      `\t - ${collateralToFlashloanTokenSwapResults.swapLabel}\n` +
      `\t - Reimburse flashloan and earning $${profitUsd} + remaining ${PEG_TOKEN.symbol}\n` +
      `\t - Cost: $${creditCostUsd}, gains: $${amountFlashloanTokenReceivedUsd}. PnL: $${
        amountFlashloanTokenReceivedUsd - creditCostUsd
      }` +
      (profitUsd < 0 ? '\nNOT BIDDING' : '');
  } else {
    msg +=
      `Bid in 2 steps via ${flashloanToken.symbol} flashloan\n` +
      `\t - Flashloan ${norm(flashloanAmountInFlashloanToken, flashloanToken.decimals)} ${flashloanToken.symbol}\n` +
      `\t - ${flashloanToPegTokenSwapResults.swapLabel}\n` +
      `\t - Bid to get ${norm(bidDetail.collateralReceived, collateralToken.decimals)} ${
        collateralToken.symbol
      }. Cost: ${norm(bidDetail.creditAsked, 18)} g${PEG_TOKEN.symbol}\n` +
      `\t - Second swap: ${collateralToFlashloanTokenSwapResults.swapLabel}\n` +
      `\t - Reimbursing flashloan and earning $${profitUsd} + remaining ${PEG_TOKEN.symbol}` +
      `\t - Cost: $${creditCostUsd}, gains: $${amountFlashloanTokenReceivedUsd}. PnL: $${
        amountFlashloanTokenReceivedUsd - creditCostUsd
      }` +
      (profitUsd < 0 ? '\nNOT BIDDING' : '');
  }

  Log(msg);

  if (profitUsd < 0) {
    return {
      estimatedProfitUsd: 0,
      flashloanAmount: 0n,
      swapData: '',
      routerAddress: '',
      swapDataToFlashloanToken: '',
      routerAddressToFlashloanToken: ''
    };
  }

  return {
    estimatedProfitUsd: profitUsd,
    flashloanAmount: flashloanAmountInFlashloanToken,
    routerAddress: flashloanToPegTokenSwapResults.routerAddress,
    swapData: flashloanToPegTokenSwapResults.swapData,
    swapDataToFlashloanToken: collateralToFlashloanTokenSwapResults.swapData,
    routerAddressToFlashloanToken: collateralToFlashloanTokenSwapResults.routerAddress
  };
}

async function processBid(
  auction: Auction,
  term: LendingTerm,
  web3Provider: ethers.JsonRpcProvider,
  minProfitUsd: number,
  flashloanToken: TokenConfig,
  flashloanAmount: bigint,
  routerAddress: string,
  swapData: string,
  routerAddressToFlashloanToken: string,
  swapDataToFlashloanToken: string,
  estimatedProfitUsd: number
) {
  if (!process.env.BIDDER_ETH_PRIVATE_KEY) {
    throw new Error('Cannot find BIDDER_ETH_PRIVATE_KEY in env');
  }

  const signer = new ethers.Wallet(process.env.BIDDER_ETH_PRIVATE_KEY, web3Provider);
  const gatewayContract = GatewayV12Steps__factory.connect(GATEWAY_ADDRESS, signer);
  const minProfitFlashloanedTokenWei = new BigNumber(
    minProfitUsd / (await PriceService.GetTokenPrice(flashloanToken.address))
  )
    .times(new BigNumber(10).pow(flashloanToken.decimals))
    .toFixed(0);

  const struct = {
    loanId: auction.loanId,
    term: auction.lendingTermAddress,
    psm: await GetPSMAddress(),
    collateralToken: term.collateralAddress,
    pegToken: PEG_TOKEN.address,
    flashloanedToken: flashloanToken.address,
    flashloanAmount: flashloanAmount,
    minProfit: minProfitFlashloanedTokenWei,
    routerAddress: routerAddress,
    routerCallData: swapData,
    routerAddressToFlashloanedToken: routerAddressToFlashloanToken,
    routerCallDataToFlashloanedToken: swapDataToFlashloanToken
  };

  const txReceipt = await gatewayContract.bidWithBalancerFlashLoan(struct, { gasLimit: 3_000_000 });
  await txReceipt.wait();

  if (term.termAddress.toLowerCase() != '0x427425372b643fc082328b70A0466302179260f5'.toLowerCase()) {
    await SendNotifications(
      'Auction Bidder',
      `Auction ${auction.loanId} fulfilled`,
      `Estimated $${estimatedProfitUsd} profit`
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

async function getKyberSwapDataForPegTokenAmount(
  pegToken: TokenConfig,
  flashloanToken: TokenConfig,
  pegTokenAmountNeeded: bigint
): Promise<{ swapData: string; routerAddress: string; flashloanAmount: bigint; swapLabel: string }> {
  // call kyberswap to get quote on the reversed route: pegToken -> flashloanToken. It will give a head start

  Log(
    `Finding big enough amount of ${flashloanToken.symbol} to swap for ${norm(
      pegTokenAmountNeeded,
      pegToken.decimals
    )} ${pegToken.symbol}`
  );

  // base amount in flashloan token unit is {pegTokenAmountNeeded} * {pegTokenPrice} / {flashloanTokenPrice}
  const baseAmountFlashloanTokenNorm =
    norm(pegTokenAmountNeeded, pegToken.decimals) *
    ((await PriceService.GetTokenPrice(pegToken.address)) / (await PriceService.GetTokenPrice(flashloanToken.address)));
  const baseAmountFlashloanToken = new BigNumber(baseAmountFlashloanTokenNorm)
    .times(new BigNumber(10).pow(flashloanToken.decimals))
    .toFixed(0);

  let flashloanAmount = BigInt(baseAmountFlashloanToken);
  let validData: any;
  let enoughFlashloanAmount = false;
  while (!enoughFlashloanAmount) {
    enoughFlashloanAmount = true;

    const urlGet =
      'https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes?' +
      `tokenIn=${flashloanToken.address}` +
      `&tokenOut=${pegToken.address}` +
      `&amountIn=${flashloanAmount.toString(10)}` +
      '&excludedSources=balancer-v1,balancer-v2-composable-stable,balancer-v2-stable,balancer-v2-weighted';

    const dataFlashloanToken = await HttpGet<any>(urlGet);
    const pegTokenReceived = BigInt(dataFlashloanToken.data.routeSummary.amountOut);

    if (pegTokenReceived < pegTokenAmountNeeded) {
      Log(
        `[NOT OK] ${norm(flashloanAmount, flashloanToken.decimals)} ${flashloanToken.symbol} gets ${norm(
          pegTokenReceived,
          pegToken.decimals
        )} ${pegToken.symbol}`
      );
      enoughFlashloanAmount = false;
      flashloanAmount = (flashloanAmount * 102n) / 100n;
      await sleep(2000);
    } else {
      Log(
        `[OK] ${norm(flashloanAmount, flashloanToken.decimals)} ${flashloanToken.symbol} gets ${norm(
          pegTokenReceived,
          pegToken.decimals
        )} ${pegToken.symbol}`
      );
      validData = dataFlashloanToken;
    }
  }

  // create the swap data using post
  const urlPost = 'https://aggregator-api.kyberswap.com/arbitrum/api/v1/route/build';
  const dataPost = await HttpPost<any>(urlPost, {
    routeSummary: validData.data.routeSummary,
    slippageTolerance: 0.005 * 10_000, // 0.005 -> 50 (0.5%)
    sender: GATEWAY_ADDRESS,
    recipient: GATEWAY_ADDRESS
  });

  const swapLabel = `Swapping ${norm(flashloanAmount, flashloanToken.decimals)} ${flashloanToken.symbol} => ${norm(
    validData.data.routeSummary.amountOut,
    pegToken.decimals
  )} ${pegToken.symbol} using Kyber`;

  return {
    swapData: dataPost.data.data,
    routerAddress: dataPost.data.routerAddress,
    flashloanAmount: flashloanAmount,
    swapLabel
  };
}

AuctionBidder();

// async function test() {
//   const data = '';

//   const abiCoder = new ethers.AbiCoder();
//   const decoded = abiCoder.decode(
//     ['(bytes32,address,address,address,address,address,uint256,uint256,address,bytes,address,bytes)'],
//     data
//   );

//   console.log(decoded);

//   // // peg token is OD, collateral is USDC and flashloaned token is WETH
//   // const collateralToken = await getTokenBySymbol('USDC');
//   // const pegToken = await getTokenBySymbol('WETH');
//   // const flashloanToken = await getTokenBySymbol('DAI');
//   // const res = await checkBidProfitability2Step(
//   //   BidderSwapMode.OPEN_OCEAN,
//   //   collateralToken.address,
//   //   { collateralReceived: 4_000n * 10n ** 6n, creditAsked: 10n ** 18n },
//   //   GetWeb3Provider(),
//   //   10n ** 18n,
//   //   flashloanToken
//   // );
// }

// test();
