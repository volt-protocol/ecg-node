import { getTokenByAddress } from '../config/Config';
import { DefiLlamaPriceResponse } from '../model/DefiLlama';
import { PendleMarketResponse } from '../model/PendleApi';
import SimpleCacheService from './CacheService';
import { NETWORK } from './Constants';
import { HttpGet } from './HttpHelper';
import { Log } from './Logger';
import { sleep } from './Utils';
import { GetWeb3Provider } from './Web3Helper';

let lastCallDefillama = 0;

export async function GetTokenPriceAtTimestamp(tokenAddress: string, timestamp: number): Promise<number | undefined> {
  // fake prices for sepolia tokens VORIAN and BEEF
  if (NETWORK == 'SEPOLIA') {
    if (tokenAddress == '0x50fdf954f95934c7389d304dE2AC961EA14e917E') {
      // VORIAN token
      return 1_000_000_000;
    }
    if (tokenAddress == '0x723211B8E1eF2E2CD7319aF4f74E7dC590044733') {
      // BEEF token
      return 40_000_000_000;
    }
  }
  const tokenId = NETWORK == 'ARBITRUM' ? `arbitrum:${tokenAddress}` : `ethereum:${tokenAddress}`;
  const cacheKey = `GetTokenPriceAtTimestamp-${tokenId}-${timestamp}`;
  const cacheDurationMs = 5 * 60 * 1000; // 5 minute cache duration

  const price = await SimpleCacheService.GetAndCache(
    cacheKey,
    () => GetDefiLlamaPriceAtTimestamp(tokenId, timestamp),
    cacheDurationMs
  );

  // Log(`GetTokenPriceAtTimestamp[${new Date(timestamp * 1000).toISOString()}]: ${tokenId} = $${price}`);

  return price;
}

export async function GetTokenPrice(tokenAddress: string): Promise<number | undefined> {
  // fake prices for sepolia tokens VORIAN and BEEF
  if (NETWORK == 'SEPOLIA') {
    if (tokenAddress == '0x50fdf954f95934c7389d304dE2AC961EA14e917E') {
      // VORIAN token
      return 1_000_000_000;
    }
    if (tokenAddress == '0x723211B8E1eF2E2CD7319aF4f74E7dC590044733') {
      // BEEF token
      return 40_000_000_000;
    }
  }

  let price: number | undefined = undefined;
  const token = getTokenByAddress(tokenAddress);
  const cacheKey = `GetTokenPrice-${token.symbol}-${token.address}`;
  const cacheDurationMs = 5 * 60 * 1000; // 5 minute cache duration
  if (token.pendleConfiguration) {
    const pendleConfig = token.pendleConfiguration;
    // fetch price using pendle api
    price = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => GetPendleApiMarketPrice(pendleConfig.market),
      cacheDurationMs
    );

    Log(`GetTokenPrice: price for ${token.symbol} from pendle: ${price}`);
  } else {
    const tokenId = NETWORK == 'ARBITRUM' ? `arbitrum:${tokenAddress}` : `ethereum:${tokenAddress}`;
    const cacheKey = `GetTokenPrice-${tokenId}`;

    price = await SimpleCacheService.GetAndCache(cacheKey, () => GetDefiLlamaPrice(tokenId), cacheDurationMs);
    Log(`GetTokenPrice: price for ${token.symbol} from llama: ${price}`);
  }

  return price;
}

export async function GetTokenPriceMulti(tokenAddresses: string[]): Promise<{ [tokenAddress: string]: number }> {
  const prices: { [tokenAddress: string]: number } = {};

  const defillamaIds: string[] = [];
  const llamaNetwork = NETWORK == 'ARBITRUM' ? 'arbitrum' : 'ethereum';

  for (const tokenAddress of tokenAddresses) {
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

    const token = getTokenByAddress(tokenAddress);

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
    const priceResponse = await HttpGet<DefiLlamaPriceResponse>(llamaUrl);

    for (const tokenAddress of tokenAddresses) {
      if (prices[tokenAddress]) {
        continue;
      }
      const token = getTokenByAddress(tokenAddress);
      const llamaId = `${llamaNetwork}:${token.mainnetAddress || token.address}`;
      const llamaPrice = priceResponse.coins[llamaId] ? priceResponse.coins[llamaId].price : 0;

      prices[tokenAddress] = llamaPrice;
      Log(`GetTokenPriceMulti: price for ${token.symbol} from llama: ${prices[tokenAddress]}`);
    }
  }

  Log(`GetTokenPriceMulti: ends with ${Object.keys(prices).length} prices`);
  return prices;
}

async function GetPendleApiMarketPrice(marketAddress: string) {
  const chainId = (await GetWeb3Provider().getNetwork()).chainId;
  const pendleApiUrl = `https://api-v2.pendle.finance/core/v1/${chainId}/markets/${marketAddress}`;
  const response = await HttpGet<PendleMarketResponse>(pendleApiUrl);
  return response.pt.price.usd;
}

async function GetDefiLlamaPrice(tokenId: string) {
  const msToWait = 1000 - (Date.now() - lastCallDefillama);
  if (msToWait > 0) {
    await sleep(msToWait);
  }

  const apiUrl = `https://coins.llama.fi/prices/current/${tokenId}?searchWidth=4h`;
  const resp = await HttpGet<DefiLlamaPriceResponse>(apiUrl);
  lastCallDefillama = Date.now();

  if (!resp.coins || !resp.coins[tokenId]) {
    return undefined;
  }

  return resp.coins[tokenId].price;
}

async function GetDefiLlamaPriceAtTimestamp(tokenId: string, timestampSec: number) {
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

  return resp.coins[tokenId].price;
}
