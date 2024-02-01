import axios, { AxiosResponse } from 'axios';
import { retry } from './Utils';
import { DefiLlamaPriceResponse } from '../model/DefiLlama';
import SimpleCacheService from './CacheService';

export async function GetTokenPrice(tokenAddress: string): Promise<number> {
  const tokenId = `ethereum:${tokenAddress}`;
  const cacheKey = `GetTokenPrice-${tokenId}`;
  const cacheDurationMs = 5 * 60 * 1000; // 5 minute cache duration

  const price = await SimpleCacheService.GetAndCache(cacheKey, () => GetDefiLlamaPrice(tokenId), cacheDurationMs);

  return price;
}

async function GetDefiLlamaPrice(tokenId: string) {
  const apiUrl = `https://coins.llama.fi/prices/current/${tokenId}?searchWidth=4h`;
  const axiosResp: AxiosResponse<DefiLlamaPriceResponse> = (await retry(axios.get, [
    apiUrl
  ])) as AxiosResponse<DefiLlamaPriceResponse>;

  return axiosResp.data.coins[tokenId].price;
}
