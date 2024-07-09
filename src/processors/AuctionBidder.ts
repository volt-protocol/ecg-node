import { Auction, AuctionStatus, AuctionsFileStructure } from '../model/Auction';
import { DATA_DIR, SWAP_MODE } from '../utils/Constants';
import { GetProtocolData, ReadJSON, sleep } from '../utils/Utils';
import path from 'path';
import {
  AuctionHouse__factory,
  GatewayV12Steps__factory,
  GatewayV1__factory,
  UniswapV2Router__factory
} from '../contracts/types';
import {
  GetGatewayAddress,
  GetGatewayAddress2Steps,
  GetNodeConfig,
  GetPSMAddress,
  GetPegTokenAddress,
  GetUniswapV2RouterAddress,
  getTokenByAddress,
  getTokenByAddressNoError,
  getTokenBySymbol
} from '../config/Config';
import { JsonRpcProvider, ethers } from 'ethers';
import LendingTerm, { LendingTermsFileStructure } from '../model/LendingTerm';
import { norm } from '../utils/TokenUtils';
import { SendNotifications } from '../utils/Notifications';
import { GetAvgGasPrice, GetERC20Infos, GetWeb3Provider } from '../utils/Web3Helper';
import { Log, Warn } from '../utils/Logger';
import { BidderSwapMode } from '../model/NodeConfig';
import { GetOpenOceanChainCodeByChainId, OpenOceanSwapQuoteResponse } from '../model/OpenOceanApi';
import { OneInchSwapResponse } from '../model/OneInchApi';
import { HttpGet, HttpPost } from '../utils/HttpHelper';
import BigNumber from 'bignumber.js';
import { PendleSwapResponse } from '../model/PendleApi';
import { TokenConfig } from '../model/Config';
import PriceService from '../services/price/PriceService';

const RUN_EVERY_SEC = 60;
let lastCall1Inch = 0;
let lastCallPendle = 0;

async function AuctionBidder() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'ECG_NODE_AUCTION_BIDDER';
    Log(`starting with swap mode: ${SWAP_MODE}`);
    const auctionBidderConfig = (await GetNodeConfig()).processors.AUCTION_BIDDER;

    const auctionsFilename = path.join(DATA_DIR, 'auctions.json');
    const termsFilename = path.join(DATA_DIR, 'terms.json');

    // wait for unlock just before reading data file
    // await FileMutex.WaitForUnlock();
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

      const pegToken = await getTokenByAddress(await GetPegTokenAddress());
      if (pegToken.flashloanToken) {
        const flashloanToken = await getTokenBySymbol(pegToken.flashloanToken);
        // 2 step swap
        const {
          estimatedProfitUsd,
          flashloanAmount,
          swapData,
          routerAddress,
          swapDataToFlashloanToken,
          routerAddressToFlashloanToken
        } = await checkBidProfitability2Step(
          SWAP_MODE,
          term.collateralAddress,
          bidDetail,
          web3Provider,
          creditMultiplier,
          flashloanToken
        );
        if (estimatedProfitUsd >= auctionBidderConfig.minProfitUsd) {
          Log(`AuctionBidder[${auction.loanId}]: will bid on auction for estimated profit: ${estimatedProfitUsd}`);
          await processBid2Step(
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
        Log(`AuctionBidder[${auction.loanId}]: do not bid, profit too low: ${estimatedProfitUsd}`);
      } else {
        const { swapData, estimatedProfitUsd, routerAddress } = await checkBidProfitability(
          SWAP_MODE,
          term,
          bidDetail,
          web3Provider,
          creditMultiplier
        );

        if (estimatedProfitUsd >= auctionBidderConfig.minProfitUsd) {
          Log(`AuctionBidder[${auction.loanId}]: will bid on auction for estimated profit: ${estimatedProfitUsd}`);
          await processBid(
            auction,
            term,
            web3Provider,
            auctionBidderConfig.minProfitUsd,
            routerAddress,
            swapData,
            estimatedProfitUsd
          );
          continue;
        }

        Log(`AuctionBidder[${auction.loanId}]: do not bid, profit too low: $${estimatedProfitUsd}`);
      }
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

async function checkBidProfitability2Step(
  swapMode: BidderSwapMode,
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

  const pegToken = await getTokenByAddress(await GetPegTokenAddress());

  // get the swap data to flashloan "flashloanToken" so that we can swap to pegToken
  const pegTokenAmountNeeded = (((bidDetail.creditAsked * creditMultiplier) / 10n ** 18n) * 1005n) / 1000n; // add 0.5% to be sure
  const { swapData, routerAddress, flashloanAmount, swapLabel } = await getKyberSwapDataForPegTokenAmount(
    pegToken,
    flashloanToken,
    pegTokenAmountNeeded
  );

  let getSwapFunction;
  // specific case for pendle, use pendle amm
  if (collateralToken.pendleConfiguration) {
    getSwapFunction = getSwapPendle;
  } else {
    switch (swapMode) {
      default:
        throw new Error(`${swapMode} not implemented`);
      case BidderSwapMode.ONE_INCH:
        getSwapFunction = getSwap1Inch;
        break;
      case BidderSwapMode.OPEN_OCEAN:
        getSwapFunction = getSwapOpenOcean;
        break;
      case BidderSwapMode.UNISWAPV2:
        getSwapFunction = getSwapUniv2;
        break;
    }
  }

  const getSwapResult = await getSwapFunction(
    collateralToken,
    flashloanToken,
    bidDetail.collateralReceived,
    web3Provider
  );

  // check the second swap give enough to reimburse the flashloan
  if (getSwapResult.toTokenReceivedWei < flashloanAmount) {
    Log(
      'Not enough flashloan token received swapping' +
        ` ${norm(bidDetail.collateralReceived, collateralToken.decimals)} ${collateralToken.symbol}` +
        ` for ${flashloanToken.symbol}. ` +
        `Receiving ${norm(getSwapResult.toTokenReceivedWei, flashloanToken.decimals)} ` +
        `${flashloanToken.symbol} while needing to flashloan ${norm(flashloanAmount, flashloanToken.decimals)} ${
          flashloanToken.symbol
        }`
    );
    return {
      estimatedProfitUsd: 0,
      flashloanAmount: 0n,
      swapData: '',
      routerAddress: '',
      swapDataToFlashloanToken: '',
      routerAddressToFlashloanToken: ''
    };
  }

  // check that the difference between amount obtained using the collateral and flashloan amout
  // if enough profit
  const amountFlashloanTokenReceivedUsd =
    norm(getSwapResult.toTokenReceivedWei, flashloanToken.decimals) *
    (await PriceService.GetTokenPrice(flashloanToken.address));
  const creditCostUsd =
    norm((bidDetail.creditAsked * creditMultiplier) / 10n ** 18n) *
    (await PriceService.GetTokenPrice(pegToken.address));

  Log(
    `checkBidProfitability: bidding cost: $${creditCostUsd}, gains: $${amountFlashloanTokenReceivedUsd}. PnL: $${
      amountFlashloanTokenReceivedUsd - creditCostUsd
    }`
  );

  const profitUsd = amountFlashloanTokenReceivedUsd - creditCostUsd;

  const msg =
    `Bidding details: collateral received: ${norm(bidDetail.collateralReceived, collateralToken.decimals)} ${
      collateralToken.symbol
    }\n` +
    `Bidding details: credit asked: ${norm(bidDetail.creditAsked, 18)} g${pegToken.symbol}\n` +
    `Bidding 2 step via ${flashloanToken.symbol}\n` +
    `\t - Flashloan ${norm(flashloanAmount, flashloanToken.decimals)} ${flashloanToken.symbol}\n` +
    `\t - ${swapLabel}\n` +
    `\t - Bidding to get ${norm(bidDetail.collateralReceived, collateralToken.decimals)} ${
      collateralToken.symbol
    }. Cost: ${norm(bidDetail.creditAsked, 18)} g${pegToken.symbol}\n` +
    `\t - Second swap: ${getSwapResult.swapLabel}\n` +
    `\t - Reimbursing flashloan and earning $${profitUsd} + remaining ${pegToken.symbol}` +
    (profitUsd < 0 ? '\nNOT BIDDING' : '');

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
    flashloanAmount: flashloanAmount,
    swapData: swapData,
    routerAddress: routerAddress,
    swapDataToFlashloanToken: getSwapResult.swapData,
    routerAddressToFlashloanToken: getSwapResult.routerAddress
  };
}

async function checkBidProfitability(
  swapMode: BidderSwapMode,
  term: LendingTerm,
  bidDetail: { collateralReceived: bigint; creditAsked: bigint },
  web3Provider: ethers.JsonRpcProvider,
  creditMultiplier: bigint
): Promise<{ swapData: string; estimatedProfitUsd: number; routerAddress: string }> {
  let collateralToken = await getTokenByAddressNoError(term.collateralAddress);
  if (!collateralToken) {
    collateralToken = await GetERC20Infos(web3Provider, term.collateralAddress);
    Warn(
      `Token ${term.collateralAddress} not found in config. ERC20 infos: ${collateralToken.symbol} / ${collateralToken.decimals} decimals`
    );
  }

  const pegToken = await getTokenByAddress(await GetPegTokenAddress());

  let getSwapFunction;
  // specific case for pendle, use pendle amm
  if (collateralToken.pendleConfiguration) {
    getSwapFunction = getSwapPendle;
  } else {
    switch (swapMode) {
      default:
        throw new Error(`${swapMode} not implemented`);
      case BidderSwapMode.ONE_INCH:
        getSwapFunction = getSwap1Inch;
        break;
      case BidderSwapMode.OPEN_OCEAN:
        getSwapFunction = getSwapOpenOcean;
        break;
      case BidderSwapMode.UNISWAPV2:
        getSwapFunction = getSwapUniv2;
        break;
    }
  }

  const getSwapResult = await getSwapFunction(collateralToken, pegToken, bidDetail.collateralReceived, web3Provider);

  const amountPegToken = norm(getSwapResult.toTokenReceivedWei, pegToken.decimals);
  const creditCostInPegToken = norm((bidDetail.creditAsked * creditMultiplier) / 10n ** 18n);

  Log(
    `checkBidProfitability: bidding cost: ${creditCostInPegToken} ${pegToken.symbol}, gains: ${amountPegToken} ${
      pegToken.symbol
    }. PnL: ${amountPegToken - creditCostInPegToken} ${pegToken.symbol}`
  );

  // always return 0 profit if negative
  if (creditCostInPegToken > amountPegToken) {
    return { swapData: '', estimatedProfitUsd: 0, routerAddress: '' };
  }

  // check if profitability > configured one
  const profitPegToken = (amountPegToken - creditCostInPegToken) * (await PriceService.GetTokenPrice(pegToken.address));

  return {
    estimatedProfitUsd: profitPegToken,
    swapData: getSwapResult.swapData,
    routerAddress: getSwapResult.routerAddress
  };
}

async function getSwapUniv2(
  fromToken: TokenConfig,
  toToken: TokenConfig,
  collateralReceivedWei: bigint,
  web3Provider: ethers.JsonRpcProvider
): Promise<{ toTokenReceivedWei: bigint; swapData: string; routerAddress: string; swapLabel: string }> {
  const univ2RouterAddress = await GetUniswapV2RouterAddress();
  const uniswapRouterContract = UniswapV2Router__factory.connect(univ2RouterAddress, web3Provider);

  const path = [fromToken.address, toToken.address];
  const swapData = uniswapRouterContract.interface.encodeFunctionData('swapExactTokensForTokens', [
    collateralReceivedWei, // amountIn
    0n, // minAmountOut ==> no need because we'll check the minProfit in the gateway
    path, // path, collateral=>pegToken
    await GetGatewayAddress(), // to gateway
    Math.round(Date.now() / 1000) + 120 // deadline in 2 minutes
  ]);

  // find the amount of pegToken that can be obtained by selling 'collateralReceivedWei' of collateralToken
  const amountsOut = await uniswapRouterContract.getAmountsOut(collateralReceivedWei, [
    fromToken.address,
    toToken.address
  ]);

  const swapLabel = `Swapping ${norm(collateralReceivedWei, fromToken.decimals)} ${fromToken.symbol} => ${norm(
    amountsOut[1],
    toToken.decimals
  )} ${toToken.symbol} using UniswapV2`;

  return {
    toTokenReceivedWei: amountsOut[1],
    swapData,
    routerAddress: univ2RouterAddress,
    swapLabel: swapLabel
  };
}

async function getSwapPendle(
  fromToken: TokenConfig,
  toToken: TokenConfig,
  collateralReceivedWei: bigint,
  web3Provider: ethers.JsonRpcProvider
): Promise<{ toTokenReceivedWei: bigint; swapData: string; routerAddress: string; swapLabel: string }> {
  const chainId = (await web3Provider.getNetwork()).chainId;
  const pendleConf = fromToken.pendleConfiguration;
  if (!pendleConf) {
    throw new Error(`Cannot find pendle configuration for token ${fromToken.address} ${fromToken.symbol}`);
  }

  const expiryDate = new Date(pendleConf.expiry);
  const pendleHostedSdkUrl =
    expiryDate.getTime() < Date.now()
      ? `https://api-v2.pendle.finance/sdk/api/v1/redeemPyToToken?chainId=${chainId}` +
        `&receiverAddr=${await GetGatewayAddress()}` +
        `&ytAddr=${pendleConf.ytAddress}` +
        `&amountPyIn=${collateralReceivedWei.toString()}` +
        `&tokenOutAddr=${toToken.address}` +
        `&syTokenOutAddr=${pendleConf.syTokenOut}` +
        '&slippage=0.005'
      : 'https://api-v2.pendle.finance/sdk/api/v1/swapExactPtForToken?' +
        `chainId=${chainId}` +
        `&receiverAddr=${await GetGatewayAddress()}` +
        `&marketAddr=${pendleConf.market}` +
        `&amountPtIn=${collateralReceivedWei.toString()}` +
        `&tokenOutAddr=${toToken.address}` +
        `&syTokenOutAddr=${pendleConf.syTokenOut}` +
        `&excludedSources=${getPendleExcludedProtocols(chainId)}` +
        '&slippage=0.05';

  Log(`pendle url: ${pendleHostedSdkUrl}`);
  const msToWait = 6000 - (Date.now() - lastCallPendle); // 1 call every 6 seconds
  if (msToWait > 0) {
    Log(`Waiting ${msToWait} ms before calling pendle api`);
    await sleep(msToWait);
  }
  const pendleSwapResponse = await HttpGet<PendleSwapResponse>(pendleHostedSdkUrl);

  lastCallPendle = Date.now();

  const swapLabel = `Swapping ${norm(collateralReceivedWei, fromToken.decimals)} ${fromToken.symbol} => ${norm(
    pendleSwapResponse.data.amountTokenOut,
    toToken.decimals
  )} ${toToken.symbol} using Pendle`;

  return {
    toTokenReceivedWei: BigInt(pendleSwapResponse.data.amountTokenOut),
    swapData: pendleSwapResponse.transaction.data,
    routerAddress: pendleSwapResponse.transaction.to,
    swapLabel: swapLabel
  };
}

function getPendleExcludedProtocols(chainCode: bigint) {
  switch (chainCode) {
    case 1n:
      return 'balancer-v1,balancer-v2-composable-stable,balancer-v2-stable,balancer-v2-weighted';
    case 42161n:
      return 'balancer-v1,balancer-v2-composable-stable,balancer-v2-stable,balancer-v2-weighted';
    default:
      throw new Error(`Unknown chaincode: ${chainCode}`);
  }
}

async function getSwap1Inch(
  fromToken: TokenConfig,
  toToken: TokenConfig,
  collateralReceivedWei: bigint,
  web3Provider: ethers.JsonRpcProvider
): Promise<{ toTokenReceivedWei: bigint; swapData: string; routerAddress: string; swapLabel: string }> {
  const ONE_INCH_API_KEY = process.env.ONE_INCH_API_KEY;
  if (!ONE_INCH_API_KEY) {
    throw new Error('Cannot load ONE_INCH_API_KEY from env variables');
  }

  const chainCode = (await web3Provider.getNetwork()).chainId;
  const maxSlippage = 1; // 1%
  const oneInchApiUrl =
    `https://api.1inch.dev/swap/v6.0/${chainCode}/swap?` +
    `src=${fromToken.address}` +
    `&dst=${toToken.address}` +
    `&amount=${collateralReceivedWei.toString()}` +
    `&from=${await GetGatewayAddress()}` +
    `&slippage=${maxSlippage}` +
    '&disableEstimate=true' + // disable onchain estimate otherwise it check if we have enough balance to do the swap, which is false
    `&excludedProtocols=${get1inchExcludedProtocols(chainCode)}`;

  Log(`getSwap1Inch: ${oneInchApiUrl}`);
  const msToWait = 1000 - (Date.now() - lastCall1Inch);
  if (msToWait > 0) {
    await sleep(msToWait);
  }
  const oneInchSwapResponse = await HttpGet<OneInchSwapResponse>(oneInchApiUrl, {
    headers: {
      Authorization: `Bearer ${ONE_INCH_API_KEY}`
    }
  });

  lastCall1Inch = Date.now();

  const swapLabel = `Swapping ${norm(collateralReceivedWei, fromToken.decimals)} ${fromToken.symbol} => ${norm(
    oneInchSwapResponse.dstAmount,
    toToken.decimals
  )} ${toToken.symbol} using 1inch`;

  return {
    toTokenReceivedWei: BigInt(oneInchSwapResponse.dstAmount),
    swapData: oneInchSwapResponse.tx.data,
    routerAddress: oneInchSwapResponse.tx.to,
    swapLabel: swapLabel
  };
}

function get1inchExcludedProtocols(chainCode: bigint) {
  switch (chainCode) {
    case 1n:
      return 'BALANCER,BALANCER_V2,BALANCER_V2_WRAPPER';
    case 42161n:
      return 'ARBITRUM_BALANCER_V2';
    default:
      throw new Error(`Unknown chaincode: ${chainCode}`);
  }
}

async function getSwapOpenOcean(
  fromToken: TokenConfig,
  toToken: TokenConfig,
  collateralReceivedWei: bigint,
  web3Provider: ethers.JsonRpcProvider
): Promise<{ toTokenReceivedWei: bigint; swapData: string; routerAddress: string; swapLabel: string }> {
  // when calling openocena, the amount must be normalzed
  const collateralAmountNorm = norm(collateralReceivedWei, fromToken.decimals).toFixed(8);
  Log(`getSwapOpenOcean: amount ${collateralAmountNorm}`);

  const chainId = (await web3Provider.getNetwork()).chainId;
  const chainCode = GetOpenOceanChainCodeByChainId(chainId);
  const gasPrice = norm((await GetAvgGasPrice()).toString(), 9) * 1.1; // avg gas price + 10%
  const maxSlippage = 1; // 1%

  const openOceanURL =
    `https://open-api.openocean.finance/v3/${chainCode}/swap_quote?` +
    `inTokenAddress=${fromToken.address}` +
    `&outTokenAddress=${toToken.address}` +
    `&amount=${collateralAmountNorm}` +
    `&slippage=${maxSlippage}` +
    `&gasPrice=${gasPrice}` +
    `&account=${await GetGatewayAddress2Steps()}` +
    `&disabledDexIds=${getOpenOceanExcludedProtocols(chainId)}`;

  // Log(`getSwapOpenOcean: ${openOceanURL}`);

  const openOceanResponse = await HttpGet<OpenOceanSwapQuoteResponse>(openOceanURL);

  const swapLabel = `Swapping ${collateralAmountNorm} ${fromToken.symbol} => ${norm(
    openOceanResponse.data.outAmount,
    toToken.decimals
  )} ${toToken.symbol} using OpenOcean`;

  return {
    toTokenReceivedWei: BigInt(openOceanResponse.data.outAmount),
    swapData: openOceanResponse.data.data,
    routerAddress: openOceanResponse.data.to,
    swapLabel: swapLabel
  };
}

function getOpenOceanExcludedProtocols(chainCode: bigint) {
  // need to take the index from this page: https://open-api.openocean.finance/v3/eth/dexList
  switch (chainCode) {
    case 1n:
      return '7,41';
    case 42161n:
      return '';
    default:
      throw new Error(`Unknown chaincode: ${chainCode}`);
  }
}

async function processBid(
  auction: Auction,
  term: LendingTerm,
  web3Provider: ethers.JsonRpcProvider,
  minProfitUsd: number,
  routerAddress: string, // either univ2, 1inch, openocean etc...
  swapData: string,
  estimatedProfitUsd: number
) {
  if (!process.env.BIDDER_ETH_PRIVATE_KEY) {
    throw new Error('Cannot find BIDDER_ETH_PRIVATE_KEY in env');
  }
  const signer = new ethers.Wallet(process.env.BIDDER_ETH_PRIVATE_KEY, web3Provider);
  const gatewayContract = GatewayV1__factory.connect(await GetGatewayAddress(), signer);
  const pegToken = await getTokenByAddress(await GetPegTokenAddress());
  const minProfitWei = new BigNumber(minProfitUsd / (await PriceService.GetTokenPrice(pegToken.address)))
    .times(new BigNumber(10).pow(pegToken.decimals))
    .toString(10);
  const txReceipt = await gatewayContract.bidWithBalancerFlashLoan(
    auction.loanId,
    auction.lendingTermAddress,
    GetPSMAddress(),
    term.collateralAddress, // collateralTokenAddress
    pegToken.address, // pegTokenAddress
    minProfitWei,
    routerAddress,
    swapData,
    { gasLimit: 2_000_000 }
  );
  await txReceipt.wait();

  if (term.termAddress.toLowerCase() != '0x427425372b643fc082328b70A0466302179260f5'.toLowerCase()) {
    await SendNotifications(
      'Auction Bidder',
      `Auction ${auction.loanId} fulfilled`,
      `Estimated $${estimatedProfitUsd} profit`
    );
  }
}

async function processBid2Step(
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
  const pegToken = await getTokenByAddress(await GetPegTokenAddress());
  const signer = new ethers.Wallet(process.env.BIDDER_ETH_PRIVATE_KEY, web3Provider);
  const gatewayContract = GatewayV12Steps__factory.connect(await GetGatewayAddress2Steps(), signer);
  const minProfitFlashloanedTokenWei = new BigNumber(
    minProfitUsd / (await PriceService.GetTokenPrice(flashloanToken.address))
  )
    .times(new BigNumber(10).pow(flashloanToken.decimals))
    .toString(10);

  /*    struct BidWithBalancerFlashLoanInput {
        bytes32 loanId;
        address term;
        address psm;
        address collateralToken;
        address pegToken;
        address flashloanedToken;
        uint256 flashloanAmount;
        uint256 minProfit; // in flashloaned token
        address routerAddress; // this can be null if flashloanedToken is the pegToken
        bytes routerCallData; // this can be null if flashloanedToken is the pegToken
        address routerAddressToFlashloanedToken;
        bytes routerCallDataToFlashloanedToken;
    }*/

  const struct = {
    loanId: auction.loanId,
    term: auction.lendingTermAddress,
    psm: await GetPSMAddress(),
    collateralToken: term.collateralAddress,
    pegToken: pegToken.address,
    flashloanedToken: flashloanToken.address,
    flashloanAmount: flashloanAmount,
    minProfit: minProfitFlashloanedTokenWei,
    routerAddress: routerAddress,
    routerCallData: swapData,
    routerAddressToFlashloanedToken: routerAddressToFlashloanToken,
    routerCallDataToFlashloanedToken: swapDataToFlashloanToken
  };

  const txReceipt = await gatewayContract.bidWithBalancerFlashLoan(struct, { gasLimit: 5_000_000 });
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
    sender: await GetGatewayAddress2Steps(),
    recipient: await GetGatewayAddress2Steps()
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
