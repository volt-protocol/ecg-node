import { median } from 'simple-statistics';
import {
  DexEnum,
  GetPendleOracleAddress,
  PendleConfig,
  TokenConfig,
  getTokenByAddress,
  getTokenByAddressNoError
} from '../config/Config';
import { PendleOracle__factory, UniswapV3Pool__factory } from '../contracts/types';
import { DefiLlamaPriceResponse } from '../model/DefiLlama';
import { PendleMarketResponse } from '../model/PendleApi';
import SimpleCacheService from './CacheService';
import { NETWORK } from './Constants';
import { HttpGet, HttpPost } from './HttpHelper';
import { Log, Warn } from './Logger';
import { norm } from './TokenUtils';
import { sleep } from './Utils';
import { GetArchiveWeb3Provider, GetERC20Infos, GetWeb3Provider } from './Web3Helper';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { MoralisTokenPrice } from '../model/Moralis';

let lastCallDefillama = 0;

export async function GetTokenPriceMultiAtTimestamp(
  tokenAddresses: string[],
  timestamp: number,
  atBlock: number
): Promise<{ [tokenAddress: string]: number }> {
  const deduplicatedTokenAddresses = Array.from(new Set<string>(tokenAddresses));
  const prices: { [tokenAddress: string]: number } = {};

  const defillamaIds: string[] = [];
  const llamaNetwork = NETWORK == 'ARBITRUM' ? 'arbitrum' : 'ethereum';

  for (const tokenAddress of deduplicatedTokenAddresses) {
    if (NETWORK == 'SEPOLIA') {
      if (tokenAddress == '0x50fdf954f95934c7389d304dE2AC961EA14e917E') {
        // VORIAN token
        prices[tokenAddress] = 1_000_000_000;
        continue;
      }
      if (tokenAddress == '0x723211B8E1eF2E2CD7319aF4f74E7dC590044733') {
        // BEEF token
        prices[tokenAddress] = 40_000_000_000;
        continue;
      }
    }

    let token = getTokenByAddressNoError(tokenAddress);
    if (!token) {
      token = await GetERC20Infos(GetWeb3Provider(), tokenAddress);
      Warn(`Token ${tokenAddress} not found in config. ERC20 infos: ${token.symbol} / ${token.decimals} decimals`);
    }

    if (token.pendleConfiguration) {
      // fetch price using pendle api
      prices[tokenAddress] = await GetPendlePriceAtBlock(token.symbol, token.pendleConfiguration, atBlock, timestamp);
      Log(`GetTokenPriceMulti: price for ${token.symbol} from pendle: ${prices[tokenAddress]}`);
      continue;
    }

    // if here, it means we will fetch price from defillama
    defillamaIds.push(`${llamaNetwork}:${token.mainnetAddress || token.address}`);
  }

  if (defillamaIds.length > 0) {
    const llamaUrl = `https://coins.llama.fi/prices/historical/${timestamp}/${defillamaIds.join(',')}?searchWidth=4h`;
    const msToWait = 1000 - (Date.now() - lastCallDefillama);
    if (msToWait > 0) {
      await sleep(msToWait);
    }
    const priceResponse = await HttpGet<DefiLlamaPriceResponse>(llamaUrl);
    lastCallDefillama = Date.now();
    for (const tokenAddress of deduplicatedTokenAddresses) {
      if (prices[tokenAddress]) {
        continue;
      }
      let token = getTokenByAddressNoError(tokenAddress);
      if (!token) {
        token = await GetERC20Infos(GetWeb3Provider(), tokenAddress);
        Warn(`Token ${tokenAddress} not found in config. ERC20 infos: ${token.symbol} / ${token.decimals} decimals`);
      }
      const llamaId = `${llamaNetwork}:${token.mainnetAddress || token.address}`;
      const llamaPrice = priceResponse.coins[llamaId] ? priceResponse.coins[llamaId].price : 0;

      prices[tokenAddress] = llamaPrice;
      Log(`GetTokenPriceMultiAtTimestamp: price for ${token.symbol} from llama: $${prices[tokenAddress]}`);
    }
  }

  Log(`GetTokenPriceMultiAtTimestamp: ends with ${Object.keys(prices).length} prices`);
  return prices;
}

//    _____  ______ ______ _____ _      _               __  __
//   |  __ \|  ____|  ____|_   _| |    | |        /\   |  \/  |   /\
//   | |  | | |__  | |__    | | | |    | |       /  \  | \  / |  /  \
//   | |  | |  __| |  __|   | | | |    | |      / /\ \ | |\/| | / /\ \
//   | |__| | |____| |     _| |_| |____| |____ / ____ \| |  | |/ ____ \
//   |_____/|______|_|    |_____|______|______/_/    \_\_|  |_/_/    \_\
//
//

function getDefillamaTokenId(network: string, tokenAddress: string) {
  const tokenId = network == 'ARBITRUM' ? `arbitrum:${tokenAddress}` : `ethereum:${tokenAddress}`;
  return tokenId;
}

async function getDefiLlamaPriceMulti(tokens: TokenConfig[]): Promise<{ [tokenAddress: string]: number }> {
  const llamaPrices: { [tokenAddress: string]: number } = {};
  const defillamaIds: string[] = [];
  const llamaNetwork = NETWORK == 'ARBITRUM' ? 'arbitrum' : 'ethereum';

  for (const token of tokens) {
    defillamaIds.push(`${llamaNetwork}:${token.mainnetAddress || token.address}`);
  }

  const llamaUrl = `https://coins.llama.fi/prices/current/${defillamaIds.join(',')}?searchWidth=4h`;
  const msToWait = 1000 - (Date.now() - lastCallDefillama);
  if (msToWait > 0) {
    await sleep(msToWait);
  }
  const priceResponse = await HttpGet<DefiLlamaPriceResponse>(llamaUrl);
  lastCallDefillama = Date.now();
  for (const token of tokens) {
    const llamaId = `${llamaNetwork}:${token.mainnetAddress || token.address}`;
    const llamaPrice = priceResponse.coins[llamaId] ? priceResponse.coins[llamaId].price : 0;

    llamaPrices[token.address] = llamaPrice;
    Log(`getDefiLlamaPriceMulti: price for ${token.symbol} from llama: ${llamaPrices[token.address]}`);
  }

  return llamaPrices;
}

async function GetDefiLlamaPriceAtTimestamp(tokenSymbol: string, tokenId: string, timestampSec: number) {
  const msToWait = 1000 - (Date.now() - lastCallDefillama);
  if (msToWait > 0) {
    await sleep(msToWait);
  }
  const apiUrl = `https://coins.llama.fi/prices/historical/${timestampSec}/${tokenId}?searchWidth=4h`;
  const resp = await HttpGet<DefiLlamaPriceResponse>(apiUrl);
  lastCallDefillama = Date.now();

  if (!resp.coins || !resp.coins[tokenId]) {
    return undefined;
  }

  Log(`GetDefiLlamaPriceAtTimestamp: price for ${tokenSymbol} from llama: $${resp.coins[tokenId].price}`);
  return resp.coins[tokenId].price;
}

//    _____  ______ _   _ _____  _      ______
//   |  __ \|  ____| \ | |  __ \| |    |  ____|
//   | |__) | |__  |  \| | |  | | |    | |__
//   |  ___/|  __| | . ` | |  | | |    |  __|
//   | |    | |____| |\  | |__| | |____| |____
//   |_|    |______|_| \_|_____/|______|______|
//
//

async function GetPendleApiMarketPrice(marketAddress: string) {
  const chainId = (await GetWeb3Provider().getNetwork()).chainId;
  const pendleApiUrl = `https://api-v2.pendle.finance/core/v1/${chainId}/markets/${marketAddress}`;
  const response = await HttpGet<PendleMarketResponse>(pendleApiUrl);
  return response.pt.price.usd;
}

async function GetPendlePriceAtBlock(
  tokenSymbol: string,
  pendleConfig: PendleConfig,
  atBlock: number,
  timestampSec: number
) {
  // get pendle price vs asset using pendle oracle
  const pendlePriceVsAsset = await GetPendleOraclePrice(pendleConfig.market, atBlock);

  // get $ price of pendle pricing asset
  const network = pendleConfig.basePricingAsset.chainId == 1 ? 'ETHEREUM' : 'ARBITRUM';
  const tokenId = getDefillamaTokenId(network, pendleConfig.basePricingAsset.address);
  const usdPriceBaseAsset = await GetDefiLlamaPriceAtTimestamp(
    pendleConfig.basePricingAsset.symbol,
    tokenId,
    timestampSec
  );
  if (!usdPriceBaseAsset) {
    throw new Error(`Cannot find price for ${tokenId} at timestamp ${timestampSec}`);
  }

  const price = pendlePriceVsAsset * usdPriceBaseAsset;
  Log(`GetPendlePriceAtBlock: price for ${tokenSymbol} from pendle: $${price}`);
  return price;
}

/**
 * Get the PT price vs the asset, example for
 * @param pendleMarketAddress
 * @param atBlock
 * @returns
 */
async function GetPendleOraclePrice(pendleMarketAddress: string, atBlock: number | undefined) {
  // if blocknumber is specified, get an archive node
  const web3Provider = atBlock ? GetArchiveWeb3Provider() : GetWeb3Provider();
  const oracleContract = PendleOracle__factory.connect(GetPendleOracleAddress(), web3Provider);
  const priceToAsset = await oracleContract.getPtToAssetRate(pendleMarketAddress, 600, { blockTag: atBlock });
  return norm(priceToAsset);
}

//    _____  ________   __
//   |  __ \|  ____\ \ / /
//   | |  | | |__   \ V /
//   | |  | |  __|   > <
//   | |__| | |____ / . \
//   |_____/|______/_/ \_\
//
//

async function GetDexPriceMulti(
  tokens: TokenConfig[],
  wethPriceUsd: number,
  atBlock?: number
): Promise<{ [tokenAddress: string]: number }> {
  const prices: { [tokenAddress: string]: number } = {};
  const web3Provider = GetWeb3Provider();
  const multicallProvider = MulticallWrapper.wrap(web3Provider);
  const promises = [];
  for (const token of tokens) {
    if (token.dexConfiguration) {
      if (token.dexConfiguration.dex == DexEnum.UNISWAP_V3) {
        for (const univ3PoolAddress of token.dexConfiguration.addresses) {
          const univ3Pool = UniswapV3Pool__factory.connect(univ3PoolAddress, multicallProvider);
          promises.push(univ3Pool.slot0({ blockTag: atBlock }));
          promises.push(univ3Pool.token0({ blockTag: atBlock }));
        }
      }
    }
  }

  const results = await Promise.all(promises);
  let cursor = 0;
  for (const token of tokens) {
    if (token.dexConfiguration) {
      if (token.dexConfiguration.dex == DexEnum.UNISWAP_V3) {
        const pricesForToken: number[] = [];
        for (const univ3PoolAddress of token.dexConfiguration.addresses) {
          const slot0 = results[cursor++] as {
            sqrtPriceX96: bigint;
            tick: bigint;
            observationIndex: bigint;
            observationCardinality: bigint;
            observationCardinalityNext: bigint;
            feeProtocol: bigint;
            unlocked: boolean;
          };
          const token0 = results[cursor++] as string;

          let priceForToken = 0;
          const quoteDecimal = token.dexConfiguration.viaWETH ? 18 : 6;
          if (token0 == token.address) {
            // means token1 is USDC or WETH
            priceForToken = getPriceNormalized(Number(slot0.tick), token.decimals, quoteDecimal);
          } else {
            // means token0 is USDC or WETH
            priceForToken = 1 / getPriceNormalized(Number(slot0.tick), quoteDecimal, token.decimals);
          }

          if (token.dexConfiguration.viaWETH) {
            priceForToken *= wethPriceUsd;
          }

          pricesForToken.push(priceForToken);
        }

        const tokenPrice = median(pricesForToken);
        Log(
          `GetDexPriceMulti: price for ${token.symbol} from DEX: ${tokenPrice} from ${pricesForToken.length} prices: ${pricesForToken}`
        );
        prices[token.address] = tokenPrice;
      }
    }
  }

  return prices;
}

function getPriceNormalized(currentTick: number, token0Decimals: number, token1Decimals: number) {
  const token0DecimalFactor = 10 ** token0Decimals;
  const token1DecimalFactor = 10 ** token1Decimals;
  const price = getTickPrice(currentTick);
  const priceToken0VsToken1 = (price * token0DecimalFactor) / token1DecimalFactor;
  return priceToken0VsToken1;
}

function getTickPrice(tick: number) {
  return 1.0001 ** tick;
}

async function getSafeWethPrice(): Promise<number> {
  return await SimpleCacheService.GetAndCache(
    'safe-weth-price',
    async () => {
      // this function must ge the eth price with stability but also not be using one of the other way of fetching price
      // so no defillama or univ3
      // choice: eth price vs usdt on binance
      const url = 'https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT';
      interface BinancePriceResponse {
        symbol: string;
        price: string;
      }

      const resp = await HttpGet<BinancePriceResponse>(url);
      const price = Number(resp.price);
      if (price == 0) {
        throw new Error('getSafeWethPrice: error when fetching weth price');
      }
      Log(`getSafeWethPrice: returning 1 WETH = $${price} from binance`);
      return price;
    },
    5 * 60 * 1000 // 5 min cache
  );
}

//    __  __  ____  _____            _      _____  _____
//   |  \/  |/ __ \|  __ \     /\   | |    |_   _|/ ____|
//   | \  / | |  | | |__) |   /  \  | |      | | | (___
//   | |\/| | |  | |  _  /   / /\ \ | |      | |  \___ \
//   | |  | | |__| | | \ \  / ____ \| |____ _| |_ ____) |
//   |_|  |_|\____/|_|  \_\/_/    \_\______|_____|_____/
//
//

async function GetMoralisPriceMulti(
  tokens: TokenConfig[],
  atBlock?: number
): Promise<{ [tokenAddress: string]: number }> {
  const prices: { [tokenAddress: string]: number } = {};

  //   curl --request POST \
  //      --url 'https://deep-index.moralis.io/api/v2.2/erc20/prices?chain=eth&include=percent_change' \
  //      --header 'accept: application/json' \
  //      --header 'X-API-Key: YOUR_API_KEY' \
  //      --header 'content-type: application/json' \
  //      --data '
  // {
  //   "tokens": [
  //     {
  //       "token_address": "0xdac17f958d2ee523a2206206994597c13d831ec7"
  //     },
  //     {
  //       "token_address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
  //     },
  //     {
  //       "exchange": "uniswapv2",
  //       "token_address": "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
  //       "to_block": "16314545"
  //     },
  //     {
  //       "token_address": "0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0"
  //     }
  //   ]
  // }
  // '

  const chain = NETWORK == 'ARBITRUM' ? 'arbitrum' : 'eth';

  const moralisTokens: { token_address: string; to_block: number | undefined }[] = [];
  const config = {
    headers: {
      Accept: 'application/json',
      'X-API-Key': process.env.MORALIS_API_KEY,
      'content-type': 'application/json'
    }
  };

  const body = {
    tokens: moralisTokens
  };

  for (const token of tokens) {
    moralisTokens.push({
      to_block: atBlock,
      token_address: token.mainnetAddress || token.address
    });
  }

  const moralisReponse = await HttpPost<MoralisTokenPrice[]>(
    `https://deep-index.moralis.io/api/v2.2/erc20/prices?chain=${chain}`,
    body,
    config
  );

  for (const token of tokens) {
    const addressToFind = token.mainnetAddress || token.address;
    const foundPrice = moralisReponse.find((_) => _.tokenAddress.toLowerCase() == addressToFind.toLowerCase());
    if (!foundPrice) {
      throw new Error(`Cannot find moralis price for ${token.symbol} with address ${addressToFind}`);
    }

    prices[token.address] = foundPrice.usdPrice;
    Log(`GetMoralisPriceMulti: price for ${token.symbol} from DEX: ${foundPrice.usdPrice}`);
  }

  return prices;
}
