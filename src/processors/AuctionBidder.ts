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
  TokenConfig,
  getTokenByAddress,
  getTokenByAddressNoError
} from '../config/Config';
import { JsonRpcProvider, ethers } from 'ethers';
import LendingTerm, { LendingTermsFileStructure } from '../model/LendingTerm';
import { norm } from '../utils/TokenUtils';
import { SendNotifications } from '../utils/Notifications';
import { GetAvgGasPrice, GetERC20Infos, GetWeb3Provider } from '../utils/Web3Helper';
import { BidderSwapMode } from '../model/NodeConfig';
import { GetOpenOceanChainCodeByChainId, OpenOceanSwapQuoteResponse } from '../model/OpenOceanApi';
import { OneInchSwapResponse } from '../model/OneInchApi';
import { HttpGet } from '../utils/HttpHelper';
import BigNumber from 'bignumber.js';
import { PendleSwapResponse } from '../model/PendleApi';
import logger from '../utils/Logger';

const RUN_EVERY_SEC = 15;
let lastCall1Inch = 0;
let lastCallPendle = 0;

async function AuctionBidder() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // load external config
    await LoadConfiguration();
    process.title = 'ECG_NODE_AUCTION_BIDDER';
    logger.debug('starting');
    const auctionBidderConfig = GetNodeConfig().processors.AUCTION_BIDDER;

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
    logger.debug(`Will check ${auctionsToCheck.length} auctions`);

    for (const auction of auctionsToCheck) {
      const term = termFileData.terms.find((_) => _.termAddress == auction.lendingTermAddress);
      if (!term) {
        throw new Error(`Cannot find term ${auction.lendingTermAddress}`);
      }
      const web3Provider = GetWeb3Provider();

      const bidDetail = await getBidDetails(auction.auctionHouseAddress, web3Provider, auction.loanId);
      if (bidDetail.auctionEnded) {
        logger.debug('Auction ended, will not try to bid');
        continue;
      }
      if (bidDetail.creditAsked == 0n && auctionBidderConfig.enableForgive) {
        logger.debug(`AuctionBidder[${auction.loanId}]: will forgive auction.`);
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
        logger.debug(`AuctionBidder[${auction.loanId}]: will bid on auction for estimated profit: ${estimatedProfit}`);
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

      logger.debug(`AuctionBidder[${auction.loanId}]: do not bid, profit too low: ${estimatedProfit}`);
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
    logger.debug('getBidDetail exception:', e);
    return {
      collateralReceived: -1n,
      creditAsked: -1n,
      auctionEnded: true
    };
  }
}

async function checkBidProfitability(
  swapMode: BidderSwapMode,
  term: LendingTerm,
  bidDetail: { collateralReceived: bigint; creditAsked: bigint },
  web3Provider: ethers.JsonRpcProvider,
  creditMultiplier: bigint
): Promise<{ swapData: string; estimatedProfit: number; routerAddress: string }> {
  let collateralToken = getTokenByAddressNoError(term.collateralAddress);
  if (!collateralToken) {
    collateralToken = await GetERC20Infos(web3Provider, term.collateralAddress);
    logger.warn(
      `Token ${term.collateralAddress} not found in config. ERC20 infos: ${collateralToken.symbol} / ${collateralToken.decimals} decimals`
    );
  }

  const pegToken = getTokenByAddress(GetPegTokenAddress());

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

  const amountPegToken = norm(getSwapResult.pegTokenReceivedWei, pegToken.decimals);
  const creditCostInPegToken = norm((bidDetail.creditAsked * creditMultiplier) / 10n ** 18n);

  logger.debug(
    `checkBidProfitability: bidding cost: ${creditCostInPegToken} ${pegToken.symbol}, gains: ${amountPegToken} ${
      pegToken.symbol
    }. PnL: ${amountPegToken - creditCostInPegToken} ${pegToken.symbol}`
  );

  // always return 0 profit if negative
  if (creditCostInPegToken > amountPegToken) {
    return { swapData: '', estimatedProfit: 0, routerAddress: '' };
  }

  // check if profitability > configured one
  const profitPegToken = amountPegToken - creditCostInPegToken;

  return {
    estimatedProfit: profitPegToken,
    swapData: getSwapResult.swapData,
    routerAddress: getSwapResult.routerAddress
  };
}

async function getSwapUniv2(
  collateralToken: TokenConfig,
  pegToken: TokenConfig,
  collateralReceivedWei: bigint,
  web3Provider: ethers.JsonRpcProvider
): Promise<{ pegTokenReceivedWei: bigint; swapData: string; routerAddress: string }> {
  const univ2RouterAddress = GetUniswapV2RouterAddress();
  const uniswapRouterContract = UniswapV2Router__factory.connect(univ2RouterAddress, web3Provider);

  const path = [collateralToken.address, pegToken.address];
  const swapData = uniswapRouterContract.interface.encodeFunctionData('swapExactTokensForTokens', [
    collateralReceivedWei, // amountIn
    0n, // minAmountOut ==> no need because we'll check the minProfit in the gateway
    path, // path, collateral=>pegToken
    GetGatewayAddress(), // to gateway
    Math.round(Date.now() / 1000) + 120 // deadline in 2 minutes
  ]);

  // find the amount of pegToken that can be obtained by selling 'collateralReceivedWei' of collateralToken
  const amountsOut = await uniswapRouterContract.getAmountsOut(collateralReceivedWei, [
    collateralToken.address,
    pegToken.address
  ]);

  return {
    pegTokenReceivedWei: amountsOut[1],
    swapData,
    routerAddress: univ2RouterAddress
  };
}

async function getSwapPendle(
  collateralToken: TokenConfig,
  pegToken: TokenConfig,
  collateralReceivedWei: bigint,
  web3Provider: ethers.JsonRpcProvider
): Promise<{ pegTokenReceivedWei: bigint; swapData: string; routerAddress: string }> {
  const chainId = (await web3Provider.getNetwork()).chainId;
  const pendleConf = collateralToken.pendleConfiguration;
  if (!pendleConf) {
    throw new Error(`Cannot find pendle configuration for token ${collateralToken.address} ${collateralToken.symbol}`);
  }

  const pendleHostedSdkUrl =
    'https://api-v2.pendle.finance/sdk/api/v1/swapExactPtForToken?' +
    `chainId=${chainId}` +
    `&receiverAddr=${GetGatewayAddress()}` +
    `&marketAddr=${pendleConf.market}` +
    `&amountPtIn=${collateralReceivedWei.toString()}` +
    `&tokenOutAddr=${pegToken.address}` +
    `&syTokenOutAddr=${pendleConf.syTokenOut}` +
    '&slippage=0.05';

  logger.debug(`pendle url: ${pendleHostedSdkUrl}`);
  const msToWait = 6000 - (Date.now() - lastCallPendle); // 1 call every 6 seconds
  if (msToWait > 0) {
    logger.debug(`Waiting ${msToWait} ms before calling pendle api`);
    await sleep(msToWait);
  }
  const pendleSwapResponse = await HttpGet<PendleSwapResponse>(pendleHostedSdkUrl);

  lastCallPendle = Date.now();

  return {
    pegTokenReceivedWei: BigInt(pendleSwapResponse.data.amountTokenOut),
    swapData: pendleSwapResponse.transaction.data,
    routerAddress: pendleSwapResponse.transaction.to
  };
}

async function getSwap1Inch(
  collateralToken: TokenConfig,
  pegToken: TokenConfig,
  collateralReceivedWei: bigint,
  web3Provider: ethers.JsonRpcProvider
): Promise<{ pegTokenReceivedWei: bigint; swapData: string; routerAddress: string }> {
  const ONE_INCH_API_KEY = process.env.ONE_INCH_API_KEY;
  if (!ONE_INCH_API_KEY) {
    throw new Error('Cannot load ONE_INCH_API_KEY from env variables');
  }

  const chainCode = (await web3Provider.getNetwork()).chainId;
  const maxSlippage = 1; // 1%
  const oneInchApiUrl =
    `https://api.1inch.dev/swap/v6.0/${chainCode}/swap?` +
    `src=${collateralToken.address}` +
    `&dst=${pegToken.address}` +
    `&amount=${collateralReceivedWei.toString()}` +
    `&from=${GetGatewayAddress()}` +
    `&slippage=${maxSlippage}` +
    '&disableEstimate=true' + // disable onchain estimate otherwise it check if we have enough balance to do the swap, which is false
    `&excludedProtocols=${get1inchExcludedProtocols(chainCode)}`;

  logger.debug(`getSwap1Inch: ${oneInchApiUrl}`);
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

  return {
    pegTokenReceivedWei: BigInt(oneInchSwapResponse.dstAmount),
    swapData: oneInchSwapResponse.tx.data,
    routerAddress: oneInchSwapResponse.tx.to
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
  collateralToken: TokenConfig,
  pegToken: TokenConfig,
  collateralReceivedWei: bigint,
  web3Provider: ethers.JsonRpcProvider
): Promise<{ pegTokenReceivedWei: bigint; swapData: string; routerAddress: string }> {
  // when calling openocena, the amount must be normalzed
  const collateralAmountNorm = norm(collateralReceivedWei, collateralToken.decimals).toFixed(8);
  logger.debug(`getSwapOpenOcean: amount ${collateralAmountNorm}`);

  const chainId = (await web3Provider.getNetwork()).chainId;
  const chainCode = GetOpenOceanChainCodeByChainId(chainId);
  const gasPrice = norm((await GetAvgGasPrice()).toString(), 9) * 1.1; // avg gas price + 10%
  const maxSlippage = 1; // 1%

  const openOceanURL =
    `https://open-api.openocean.finance/v3/${chainCode}/swap_quote?` +
    `inTokenAddress=${collateralToken.address}` +
    `&outTokenAddress=${pegToken.address}` +
    `&amount=${collateralAmountNorm}` +
    `&slippage=${maxSlippage}` +
    `&gasPrice=${gasPrice}` +
    `&account=${GetGatewayAddress()}` +
    `&disabledDexIds=${getOpenOceanExcludedProtocols(chainId)}`;

  logger.debug(`getSwapOpenOcean: ${openOceanURL}`);

  const openOceanResponse = await HttpGet<OpenOceanSwapQuoteResponse>(openOceanURL);

  return {
    pegTokenReceivedWei: BigInt(openOceanResponse.data.outAmount),
    swapData: openOceanResponse.data.data,
    routerAddress: openOceanResponse.data.to
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
  const minProfitWei = new BigNumber(minProfit)
    .times(new BigNumber(10).pow(getTokenByAddress(GetPegTokenAddress()).decimals))
    .toString(10);
  const txReceipt = await gatewayContract.bidWithBalancerFlashLoan(
    auction.loanId,
    auction.lendingTermAddress,
    GetPSMAddress(),
    term.collateralAddress, // collateralTokenAddress
    GetPegTokenAddress(), // pegTokenAddress
    minProfitWei,
    routerAddress,
    swapData,
    { gasLimit: 2_000_000 }
  );
  await txReceipt.wait();
  const pegToken = getTokenByAddress(GetPegTokenAddress());

  if (term.termAddress.toLowerCase() != '0x427425372b643fc082328b70A0466302179260f5'.toLowerCase()) {
    await SendNotifications(
      'Auction Bidder',
      `Auction ${auction.loanId} fulfilled`,
      `Estimated ${estimatedProfit} ${pegToken.symbol} profit`
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
