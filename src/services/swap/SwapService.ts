import { ethers } from 'ethers';
import { GetUniswapV2RouterAddress } from '../../config/Config';
import { UniswapV2Router__factory } from '../../contracts/types';
import { TokenConfig } from '../../model/Config';
import { norm } from '../../utils/TokenUtils';
import { Log } from '../../utils/Logger';
import { sleep } from '../../utils/Utils';
import { HttpGet, HttpPost } from '../../utils/HttpHelper';
import { PendleSwapResponse } from '../../model/PendleApi';
import { OneInchSwapResponse } from '../../model/OneInchApi';
import { GetOpenOceanChainCodeByChainId, OpenOceanSwapQuoteResponse } from '../../model/OpenOceanApi';
import { GetAvgGasPrice } from '../../utils/Web3Helper';
import { KyberSwapGetResponse } from '../../model/KyberSwapGetResponse';
import { KyberSwapPostResponse } from '../../model/KyberSwapPostResponse';
import { NETWORK } from '../../utils/Constants';
import { OdosQuoteAssemble, OdosQuoteResponse } from '../../model/OdosApi';
import { FlashloanProvider, FlashloanProviderEnum } from '../../model/FlashloanProviders';

let lastCallPendle = 0;
let lastCall1Inch = 0;

export default class SwapService {
  static async GetSwapUniv2(
    fromToken: TokenConfig,
    toToken: TokenConfig,
    collateralReceivedWei: bigint,
    web3Provider: ethers.JsonRpcProvider,
    receiverAddr: string,
    flashloanProvider: FlashloanProvider
  ): Promise<{ toTokenReceivedWei: bigint; swapData: string; routerAddress: string; swapLabel: string }> {
    const univ2RouterAddress = await GetUniswapV2RouterAddress();
    const uniswapRouterContract = UniswapV2Router__factory.connect(univ2RouterAddress, web3Provider);

    const path = [fromToken.address, toToken.address];
    const swapData = uniswapRouterContract.interface.encodeFunctionData('swapExactTokensForTokens', [
      collateralReceivedWei, // amountIn
      0n, // minAmountOut ==> no need because we'll check the minProfit in the gateway
      path, // path, collateral=>pegToken
      receiverAddr, // to gateway
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

  static async GetSwapPendle(
    fromToken: TokenConfig,
    toToken: TokenConfig,
    collateralReceivedWei: bigint,
    web3Provider: ethers.JsonRpcProvider,
    receiverAddr: string,
    flashloanProvider: FlashloanProvider
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
          `&receiverAddr=${receiverAddr}` +
          `&ytAddr=${pendleConf.ytAddress}` +
          `&amountPyIn=${collateralReceivedWei.toString()}` +
          `&tokenOutAddr=${toToken.address}` +
          `&syTokenOutAddr=${pendleConf.syTokenOut}` +
          '&slippage=0.005'
        : 'https://api-v2.pendle.finance/sdk/api/v1/swapExactPtForToken?' +
          `chainId=${chainId}` +
          `&receiverAddr=${receiverAddr}` +
          `&marketAddr=${pendleConf.market}` +
          `&amountPtIn=${collateralReceivedWei.toString()}` +
          `&tokenOutAddr=${toToken.address}` +
          `&syTokenOutAddr=${pendleConf.syTokenOut}` +
          `&excludedSources=${getPendleExcludedProtocols(chainId, flashloanProvider)}` +
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

  static async GetSwap1Inch(
    fromToken: TokenConfig,
    toToken: TokenConfig,
    collateralReceivedWei: bigint,
    web3Provider: ethers.JsonRpcProvider,
    receiverAddr: string,
    flashloanProvider: FlashloanProvider
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
      `&from=${receiverAddr}` +
      `&slippage=${maxSlippage}` +
      '&disableEstimate=true' + // disable onchain estimate otherwise it check if we have enough balance to do the swap, which is false
      `&excludedProtocols=${get1inchExcludedProtocols(chainCode, flashloanProvider)}`;

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

  static async GetSwapOpenOcean(
    fromToken: TokenConfig,
    toToken: TokenConfig,
    collateralReceivedWei: bigint,
    web3Provider: ethers.JsonRpcProvider,
    receiverAddr: string,
    flashloanProvider: FlashloanProvider
  ): Promise<{ toTokenReceivedWei: bigint; swapData: string; routerAddress: string; swapLabel: string }> {
    // when calling openocena, the amount must be normalzed
    const collateralAmountNorm = norm(collateralReceivedWei, fromToken.decimals).toFixed(8);
    // Log(`getSwapOpenOcean: amount ${collateralAmountNorm}`);

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
      `&account=${receiverAddr}` +
      `&disabledDexIds=${getOpenOceanExcludedProtocols(chainId, flashloanProvider)}`;

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

  static async GetSwapOdos(
    fromToken: TokenConfig,
    toToken: TokenConfig,
    collateralReceivedWei: bigint,
    web3Provider: ethers.JsonRpcProvider,
    receiverAddr: string,
    flashloanProvider: FlashloanProvider
  ): Promise<{ toTokenReceivedWei: bigint; swapData: string; routerAddress: string; swapLabel: string }> {
    const chainId = (await web3Provider.getNetwork()).chainId;
    const odosQuoteURL = 'https://api.odos.xyz/sor/quote/v2';
    const body = {
      chainId: NETWORK == 'ARBITRUM' ? 42161 : 1,
      compact: true,
      inputTokens: [
        {
          amount: collateralReceivedWei.toString(10),
          tokenAddress: fromToken.address
        }
      ],
      outputTokens: [
        {
          proportion: 1,
          tokenAddress: toToken.address
        }
      ],
      referralCode: 0,
      slippageLimitPercent: 0.3,
      sourceBlacklist: getOdosExcludedProtocols(chainId, flashloanProvider),
      userAddr: receiverAddr
    };

    const odosQuoteResponse = await HttpPost<OdosQuoteResponse>(odosQuoteURL, body);
    const odosAssembleUrl = 'https://api.odos.xyz/sor/assemble';
    const odosAssembleResponse = await HttpPost<OdosQuoteAssemble>(odosAssembleUrl, {
      pathId: odosQuoteResponse.pathId,
      simulate: false,
      userAddr: receiverAddr
    });

    const swapLabel = `Swapping ${norm(collateralReceivedWei, fromToken.decimals)} ${fromToken.symbol} => ${norm(
      odosQuoteResponse.outAmounts[0],
      toToken.decimals
    )} ${toToken.symbol} using ODOS`;

    return {
      toTokenReceivedWei: BigInt(odosQuoteResponse.outAmounts[0]),
      swapData: odosAssembleResponse.transaction.data,
      routerAddress: odosAssembleResponse.transaction.to,
      swapLabel: swapLabel
    };
  }

  static async GetSwapKyber(
    fromToken: TokenConfig,
    toToken: TokenConfig,
    collateralReceivedWei: bigint,
    web3Provider: ethers.JsonRpcProvider,
    receiverAddr: string,
    flashloanProvider: FlashloanProvider
  ): Promise<{ toTokenReceivedWei: bigint; swapData: string; routerAddress: string; swapLabel: string }> {
    const chainId = (await web3Provider.getNetwork()).chainId;

    const urlGet =
      'https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes?' +
      `tokenIn=${fromToken.address}` +
      `&tokenOut=${toToken.address}` +
      `&amountIn=${collateralReceivedWei.toString(10)}` +
      `&excludedProtocols=${getKyberExcludedProtocols(chainId, flashloanProvider)}`;

    const kyberResp = await HttpGet<KyberSwapGetResponse>(urlGet);

    const urlPost = 'https://aggregator-api.kyberswap.com/arbitrum/api/v1/route/build';
    const dataPost = await HttpPost<KyberSwapPostResponse>(
      urlPost,
      {
        routeSummary: kyberResp.data.routeSummary,
        slippageTolerance: 50, // 0.005 -> 50 (0.5%)
        sender: receiverAddr,
        recipient: receiverAddr
      },
      {
        headers: {
          'x-client-id': 'EthereumCreditGuild'
        }
      }
    );

    const swapLabel = `Swapping ${norm(collateralReceivedWei, fromToken.decimals)} ${fromToken.symbol} => ${norm(
      dataPost.data.amountOut,
      toToken.decimals
    )} ${toToken.symbol} using Kyber`;

    return {
      toTokenReceivedWei: BigInt(dataPost.data.amountOut),
      swapData: dataPost.data.data,
      routerAddress: dataPost.data.routerAddress,
      swapLabel: swapLabel
    };
  }
}

function getPendleExcludedProtocols(chainCode: bigint, flashloanProvider: FlashloanProvider) {
  switch (chainCode) {
    case 1n:
      switch (flashloanProvider.type) {
        case FlashloanProviderEnum.BALANCER:
          return 'balancer-v1,balancer-v2-composable-stable,balancer-v2-stable,balancer-v2-weighted';
        case FlashloanProviderEnum.AAVE:
          return '';
        default:
          throw new Error(`Unknown flashloan provider: ${flashloanProvider.type}`);
      }
    case 42161n:
      switch (flashloanProvider.type) {
        case FlashloanProviderEnum.BALANCER:
          return 'balancer-v1,balancer-v2-composable-stable,balancer-v2-stable,balancer-v2-weighted';
        case FlashloanProviderEnum.AAVE:
          return '';
        default:
          throw new Error(`Unknown flashloan provider: ${flashloanProvider.type}`);
      }
    default:
      throw new Error(`Unknown chaincode: ${chainCode}`);
  }
}

function get1inchExcludedProtocols(chainCode: bigint, flashloanProvider: FlashloanProvider) {
  switch (chainCode) {
    case 1n:
      switch (flashloanProvider.type) {
        case FlashloanProviderEnum.BALANCER:
          return 'BALANCER,BALANCER_V2,BALANCER_V2_WRAPPER';
        case FlashloanProviderEnum.AAVE:
          return '';
        default:
          throw new Error(`Unknown flashloan provider: ${flashloanProvider.type}`);
      }
    case 42161n:
      switch (flashloanProvider.type) {
        case FlashloanProviderEnum.BALANCER:
          return 'ARBITRUM_BALANCER_V2';
        case FlashloanProviderEnum.AAVE:
          return '';
        default:
          throw new Error(`Unknown flashloan provider: ${flashloanProvider.type}`);
      }
    default:
      throw new Error(`Unknown chaincode: ${chainCode}`);
  }
}

function getOpenOceanExcludedProtocols(chainCode: bigint, flashloanProvider: FlashloanProvider) {
  // need to take the index from this page: https://open-api.openocean.finance/v3/eth/dexList
  switch (chainCode) {
    case 1n:
      switch (flashloanProvider.type) {
        case FlashloanProviderEnum.BALANCER:
          return '7,41';
        case FlashloanProviderEnum.AAVE:
          return '';
        default:
          throw new Error(`Unknown flashloan provider: ${flashloanProvider.type}`);
      }
    case 42161n:
      switch (flashloanProvider.type) {
        case FlashloanProviderEnum.BALANCER:
          return '2';
        case FlashloanProviderEnum.AAVE:
          return '';
        default:
          throw new Error(`Unknown flashloan provider: ${flashloanProvider.type}`);
      }
    default:
      throw new Error(`Unknown chaincode: ${chainCode}`);
  }
}

function getKyberExcludedProtocols(chainCode: bigint, flashloanProvider: FlashloanProvider) {
  // need to take the index from this page: https://open-api.openocean.finance/v3/eth/dexList
  switch (chainCode) {
    case 1n:
      switch (flashloanProvider.type) {
        case FlashloanProviderEnum.BALANCER:
          return 'balancer-v1,balancer-v2-composable-stable,balancer-v2-stable,balancer-v2-weighted';
        case FlashloanProviderEnum.AAVE:
          return '';
        default:
          throw new Error(`Unknown flashloan provider: ${flashloanProvider.type}`);
      }
    case 42161n:
      switch (flashloanProvider.type) {
        case FlashloanProviderEnum.BALANCER:
          return 'balancer-v1,balancer-v2-composable-stable,balancer-v2-stable,balancer-v2-weighted';
        case FlashloanProviderEnum.AAVE:
          return '';
        default:
          throw new Error(`Unknown flashloan provider: ${flashloanProvider.type}`);
      }
    default:
      throw new Error(`Unknown chaincode: ${chainCode}`);
  }
}

function getOdosExcludedProtocols(chainCode: bigint, flashloanProvider: FlashloanProvider) {
  // need to take the index from this page: https://open-api.openocean.finance/v3/eth/dexList
  switch (chainCode) {
    case 42161n:
      switch (flashloanProvider.type) {
        case FlashloanProviderEnum.BALANCER:
          return ['Balancer V2 Stable', 'Balancer V2 Weighted'];
        case FlashloanProviderEnum.AAVE:
          return [];
        default:
          throw new Error(`Unknown flashloan provider: ${flashloanProvider.type}`);
      }
    default:
      throw new Error(`Unknown chaincode: ${chainCode}`);
  }
}
