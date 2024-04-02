import { DefiLlamaPriceResponse } from '../model/DefiLlama';
import SimpleCacheService from './CacheService';
import { HttpGet } from './HttpHelper';

export async function GetTokenPriceAtTimestamp(tokenAddress: string, timestamp: number): Promise<number> {
  const tokenId = `ethereum:${tokenAddress}`;
  const cacheKey = `GetTokenPriceAtTimestamp-${tokenId}-${timestamp}`;
  const cacheDurationMs = 5 * 60 * 1000; // 5 minute cache duration

  const price = await SimpleCacheService.GetAndCache(
    cacheKey,
    () => GetDefiLlamaPriceAtTimestamp(tokenId, timestamp),
    cacheDurationMs
  );

  return price;
}

export async function GetTokenPrice(tokenAddress: string): Promise<number> {
  const tokenId = `ethereum:${tokenAddress}`;
  const cacheKey = `GetTokenPrice-${tokenId}`;
  const cacheDurationMs = 5 * 60 * 1000; // 5 minute cache duration

  const price = await SimpleCacheService.GetAndCache(cacheKey, () => GetDefiLlamaPrice(tokenId), cacheDurationMs);

  return price;
}

async function GetDefiLlamaPrice(tokenId: string) {
  const apiUrl = `https://coins.llama.fi/prices/current/${tokenId}?searchWidth=4h`;
  const resp = await HttpGet<DefiLlamaPriceResponse>(apiUrl);
  return resp.coins[tokenId].price;
}

async function GetDefiLlamaPriceAtTimestamp(tokenId: string, timestampSec: number) {
  const apiUrl = `https://coins.llama.fi/prices/historical/${timestampSec}/${tokenId}?searchWidth=4h`;
  const resp = await HttpGet<DefiLlamaPriceResponse>(apiUrl);
  return resp.coins[tokenId].price;
}
