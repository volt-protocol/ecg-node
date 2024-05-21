import { GetPendleOracleAddress, PendleConfig, getTokenByAddress, getTokenByAddressNoError } from '../config/Config';
import { PendleOracle__factory } from '../contracts/types';
import { DefiLlamaPriceResponse } from '../model/DefiLlama';
import { PendleMarketResponse } from '../model/PendleApi';
import SimpleCacheService from './CacheService';
import { NETWORK } from './Constants';
import { HttpGet } from './HttpHelper';
import { Log, Warn } from './Logger';
import { norm } from './TokenUtils';
import { sleep } from './Utils';
import { GetArchiveWeb3Provider, GetERC20Infos, GetWeb3Provider } from './Web3Helper';

let lastCallDefillama = 0;

export async function GetTokenPrice(tokenAddress: string): Promise<number | undefined> {
  const token = getTokenByAddress(tokenAddress);
  const cacheKey = `GetTokenPrice-${token.symbol}-${token.address}`;
  const cacheDurationMs = 5 * 60 * 1000; // 5 minute cache duration
  const price = await SimpleCacheService.GetAndCache(
    cacheKey,
    async () => {
      const tokenPrices = await GetTokenPriceMulti([tokenAddress]);
      return tokenPrices[tokenAddress];
    },
    cacheDurationMs
  );

  return price;
}

export async function GetTokenPriceMulti(tokenAddresses: string[]): Promise<{ [tokenAddress: string]: number }> {
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
      prices[tokenAddress] = await GetPendleApiMarketPrice(token.pendleConfiguration.market);
      Log(`GetTokenPriceMulti: price for ${token.symbol} from pendle: ${prices[tokenAddress]}`);
      continue;
    }

    // if here, it means we will fetch price from defillama
    defillamaIds.push(`${llamaNetwork}:${token.mainnetAddress || token.address}`);
  }

  if (defillamaIds.length > 0) {
    const llamaUrl = `https://coins.llama.fi/prices/current/${defillamaIds.join(',')}?searchWidth=4h`;
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
      Log(`GetTokenPriceMulti: price for ${token.symbol} from llama: ${prices[tokenAddress]}`);
    }
  }

  Log(`GetTokenPriceMulti: ends with ${Object.keys(prices).length} prices`);
  return prices;
}

export async function GetTokenPriceAtTimestamp(
  tokenAddress: string,
  timestamp: number,
  atBlock: number
): Promise<number | undefined> {
  const token = getTokenByAddress(tokenAddress);
  const cacheKey = `GetTokenPriceAtTimestamp-${token.symbol}-${token.address}-${timestamp}`;
  const cacheDurationMs = 5 * 60 * 1000; // 5 minute cache duration

  const price = await SimpleCacheService.GetAndCache(
    cacheKey,
    async () => {
      const tokenPrices = await GetTokenPriceMultiAtTimestamp([tokenAddress], timestamp, atBlock);
      return tokenPrices[tokenAddress];
    },
    cacheDurationMs
  );

  return price;
}

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
