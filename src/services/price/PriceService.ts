import { median } from 'simple-statistics';
import { DexEnum, LoadConfiguration, TokenConfig, getAllTokens, getTokenByAddressNoError } from '../../config/Config';
import { NETWORK } from '../../utils/Constants';
import { Log, Warn } from '../../utils/Logger';
import { GetERC20Infos, GetWeb3Provider } from '../../utils/Web3Helper';
import { UniswapV3Pool__factory } from '../../contracts/types';
import SimpleCacheService from '../cache/CacheService';
import { HttpGet } from '../../utils/HttpHelper';
import { PendleMarketResponse } from '../../model/PendleApi';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { DefiLlamaPriceResponse } from '../../model/DefiLlama';
import { sleep } from '../../utils/Utils';
import { CoingeckoPriceResponse } from '../../model/Coingecko';
import { CoincapAssetsResponse } from '../../model/Coincap';
import { TokenListResponse } from '../../model/OpenOceanApi';
import { DexGuruTokensResponse } from '../../model/DexGuru';
import { SendNotifications } from '../../utils/Notifications';

interface PriceResult {
  source: string;
  prices: { [tokenAddress: string]: number };
}

let lastCallDefillama = 0;
const PRICE_CACHE_DURATION = 10 * 60 * 1000; // 10 min cache duration
export default class PriceService {
  static async GetTokenPrice(tokenAddress: string) {
    const allPrices = await SimpleCacheService.GetAndCache(
      'config-tokens-prices',
      LoadConfigTokenPrices,
      PRICE_CACHE_DURATION
    );

    if (allPrices[tokenAddress] == undefined) {
      Warn(`GetTokenPrice: price not found in cache for ${tokenAddress}, fetching price from defillama only`);
      const unkTokenPrice = await SimpleCacheService.GetAndCache(
        `unk-token-price-${tokenAddress}`,
        async () => {
          let unkToken = getTokenByAddressNoError(tokenAddress);
          if (!unkToken) {
            unkToken = await GetERC20Infos(GetWeb3Provider(), tokenAddress);
          }
          const priceResult = await GetDefiLlamaPriceMulti([unkToken]);
          return priceResult.prices[tokenAddress];
        },
        PRICE_CACHE_DURATION
      );

      return unkTokenPrice;
    } else {
      return allPrices[tokenAddress];
    }
  }
}

// this load all prices from token found in config
async function LoadConfigTokenPrices(): Promise<{ [tokenAddress: string]: number }> {
  Log('LoadConfigTokenPrices: loading configuration token prices');
  const allPrices: { [tokenAddress: string]: number } = {};
  const tokens = getAllTokens();
  Log(`LoadConfigTokenPrices: will fetch price for ${tokens.length} tokens`);
  const genericTokenToFetch: TokenConfig[] = [];

  for (const token of tokens) {
    if (NETWORK == 'SEPOLIA') {
      if (token.address == '0x50fdf954f95934c7389d304dE2AC961EA14e917E') {
        // VORIAN token
        allPrices[token.address] = 1_000_000_000;
        continue;
      }
      if (token.address == '0x723211B8E1eF2E2CD7319aF4f74E7dC590044733') {
        // BEEF token
        allPrices[token.address] = 40_000_000_000;
        continue;
      }
    }

    if (token.protocolToken) {
      // ignoring price for protocol token
      allPrices[token.address] = 0;
      continue;
    }

    if (token.pendleConfiguration) {
      // fetch price using pendle api
      allPrices[token.address] = await GetPendleApiMarketPrice(token.pendleConfiguration.market);
      Log(`LoadConfigTokenPrices: price for ${token.symbol} from pendle: ${allPrices[token.address]}`);
      continue;
    }

    // if here, it means we will fetch price from defillama
    genericTokenToFetch.push(token);
  }

  if (genericTokenToFetch.length > 0) {
    const wethPrice = await getSafeWethPrice();
    const priceResults = await Promise.all([
      GetDefiLlamaPriceMulti(genericTokenToFetch),
      GetDexPriceMulti(genericTokenToFetch, wethPrice),
      GetCoinGeckoPriceMulti(genericTokenToFetch),
      GetCoinCapPriceMulti(genericTokenToFetch),
      GetOpenOceanPriceMulti(genericTokenToFetch),
      GetDexGuruPriceMulti(genericTokenToFetch),
      GetOneInchPriceMulti(genericTokenToFetch)
    ]);

    for (const token of genericTokenToFetch) {
      const prices: number[] = [];

      for (const priceResult of priceResults) {
        const tokenPrice = priceResult.prices[token.address];
        if (tokenPrice != undefined) {
          prices.push(tokenPrice);
        }
      }

      if (prices.filter((_) => _ == 0).length >= prices.length) {
        throw new Error(`More than half the prices are zero: ${prices} for token ${token.symbol}`);
      }

      if (prices.length == 0) {
        allPrices[token.address] = 0;
      } else {
        // use median price from all sources
        allPrices[token.address] = median(prices);
      }

      for (const priceResult of priceResults) {
        const priceSource = priceResult.source;
        const tokenPrice = priceResult.prices[token.address];
        if (tokenPrice != undefined) {
          const absDeviation = Math.abs(allPrices[token.address] - tokenPrice) / allPrices[token.address];
          if (absDeviation >= 20 / 100) {
            const msg = `Token ${token.symbol} price from source ${priceSource} seems wrong (${Math.round(
              absDeviation * 100
            )}% off): $${tokenPrice} vs median $${allPrices[token.address]}`;
            Warn(msg);
            await SendNotifications('PriceService', `${token.symbol} ${priceSource} price deviation`, msg);
          }
        }
      }

      Log(
        `LoadConfigTokenPrices: price for ${token.symbol}: $${allPrices[token.address]}. Medianed from ${
          prices.length
        } sources: ${prices}`
      );
    }
  }

  Log(`LoadConfigTokenPrices: ends with ${Object.keys(allPrices).length} prices`);

  return allPrices;
}

// this function must ge the eth price with stability but also not be using one of the other way of fetching price
// so no defillama or univ3
// choice: eth price vs usdt on binance
async function getSafeWethPrice(): Promise<number> {
  return await SimpleCacheService.GetAndCache(
    'safe-weth-price',
    async () => {
      const url = 'https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT';
      interface BinancePriceResponse {
        symbol: string;
        price: string;
      }

      const resp = await HttpGet<BinancePriceResponse>(url, undefined, 3);
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
  const response = await HttpGet<PendleMarketResponse>(pendleApiUrl, undefined, 3);
  return response.pt.price.usd;
}

//    _____  ________   __
//   |  __ \|  ____\ \ / /
//   | |  | | |__   \ V /
//   | |  | |  __|   > <
//   | |__| | |____ / . \
//   |_____/|______/_/ \_\
//
//

async function GetDexPriceMulti(tokens: TokenConfig[], wethPriceUsd: number): Promise<PriceResult> {
  const prices: { [tokenAddress: string]: number } = {};
  const web3Provider = GetWeb3Provider();
  const multicallProvider = MulticallWrapper.wrap(web3Provider);
  const promises = [];
  for (const token of tokens) {
    if (token.dexConfiguration) {
      if (token.dexConfiguration.dex == DexEnum.UNISWAP_V3) {
        for (const univ3PoolAddress of token.dexConfiguration.addresses) {
          const univ3Pool = UniswapV3Pool__factory.connect(univ3PoolAddress, multicallProvider);
          promises.push(univ3Pool.slot0());
          promises.push(univ3Pool.token0());
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
          `GetDexPriceMulti: price for ${token.symbol} from DEX: $${tokenPrice} from ${pricesForToken.length} prices: ${pricesForToken}`
        );
        prices[token.address] = tokenPrice;
      }
    }
  }

  return { source: 'DEX', prices: prices };
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

async function GetDefiLlamaPriceMulti(tokens: TokenConfig[]): Promise<PriceResult> {
  const llamaPrices: { [tokenAddress: string]: number } = {};
  const defillamaIds: string[] = [];

  for (const token of tokens) {
    defillamaIds.push(getDefillamaTokenId(NETWORK, token.mainnetAddress || token.address));
  }
  try {
    const llamaUrl = `https://coins.llama.fi/prices/current/${defillamaIds.join(',')}?searchWidth=4h`;
    const msToWait = 1000 - (Date.now() - lastCallDefillama);
    if (msToWait > 0) {
      await sleep(msToWait);
    }
    const priceResponse = await HttpGet<DefiLlamaPriceResponse>(llamaUrl, undefined, 3);
    lastCallDefillama = Date.now();
    for (const token of tokens) {
      const llamaId = getDefillamaTokenId(NETWORK, token.mainnetAddress || token.address);
      const llamaPrice = priceResponse.coins[llamaId] ? priceResponse.coins[llamaId].price : 0;

      llamaPrices[token.address] = llamaPrice;
      Log(`getDefiLlamaPriceMulti: price for ${token.symbol} from llama: $${llamaPrices[token.address]}`);
    }
  } catch (e) {
    Warn('Exception calling defillama price api', e);
    for (const token of tokens) {
      llamaPrices[token.address] = 0;

      Log(`getDefiLlamaPriceMulti: price for ${token.symbol} from llama: $${llamaPrices[token.address]}`);
    }
  }

  return { source: 'DefiLlama', prices: llamaPrices };
}

//     _____ ____ _____ _   _  _____ ______ _____ _  ______
//    / ____/ __ \_   _| \ | |/ ____|  ____/ ____| |/ / __ \
//   | |   | |  | || | |  \| | |  __| |__ | |    | ' / |  | |
//   | |   | |  | || | | . ` | | |_ |  __|| |    |  <| |  | |
//   | |___| |__| || |_| |\  | |__| | |___| |____| . \ |__| |
//    \_____\____/_____|_| \_|\_____|______\_____|_|\_\____/
//
//

async function GetCoinGeckoPriceMulti(tokens: TokenConfig[]): Promise<PriceResult> {
  const prices: { [tokenAddress: string]: number } = {};

  const coingeckoIds = tokens
    .filter((_) => _.coingeckoId)
    .map((_) => _.coingeckoId)
    .join(',');

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoIds}&vs_currencies=usd`;
    const coingeckoResponse = await HttpGet<CoingeckoPriceResponse>(url, undefined, 3);

    for (const token of tokens) {
      if (token.coingeckoId) {
        if (coingeckoResponse[token.coingeckoId]) {
          prices[token.address] = coingeckoResponse[token.coingeckoId].usd;
        } else {
          prices[token.address] = 0;
        }

        Log(`GetCoinGeckoPriceMulti: price for ${token.symbol} from coingecko: $${prices[token.address]}`);
      }
    }
  } catch (e) {
    Warn('Exception calling coingecko price api', e);
    for (const token of tokens) {
      if (token.coingeckoId) {
        prices[token.address] = 0;

        Log(`GetCoinGeckoPriceMulti: price for ${token.symbol} from coingecko: $${prices[token.address]}`);
      }
    }
  }
  return { source: 'Coingecko', prices: prices };
}

//     _____ ____ _____ _   _  _____          _____
//    / ____/ __ \_   _| \ | |/ ____|   /\   |  __ \
//   | |   | |  | || | |  \| | |       /  \  | |__) |
//   | |   | |  | || | | . ` | |      / /\ \ |  ___/
//   | |___| |__| || |_| |\  | |____ / ____ \| |
//    \_____\____/_____|_| \_|\_____/_/    \_\_|
//
//

async function GetCoinCapPriceMulti(tokens: TokenConfig[]): Promise<PriceResult> {
  const prices: { [tokenAddress: string]: number } = {};

  const coincapIds = tokens
    .filter((_) => _.coincapId)
    .map((_) => _.coincapId)
    .join(',');

  try {
    const url = `https://api.coincap.io/v2/assets?ids=${coincapIds}`;
    const coincapResponse = await HttpGet<CoincapAssetsResponse>(url, undefined, 3);

    for (const token of tokens) {
      if (token.coincapId) {
        const foundAsset = coincapResponse.data.find((_) => _.id == token.coincapId);

        if (foundAsset) {
          prices[token.address] = Number(foundAsset.priceUsd);
        } else {
          prices[token.address] = 0;
        }

        Log(`GetCoinCapPriceMulti: price for ${token.symbol} from coincap: $${prices[token.address]}`);
      }
    }
  } catch (e) {
    Warn('Exception calling coincap price api', e);
    for (const token of tokens) {
      if (token.coingeckoId) {
        prices[token.address] = 0;

        Log(`GetCoinCapPriceMulti: price for ${token.symbol} from coincap: $${prices[token.address]}`);
      }
    }
  }

  return { source: 'Coincap', prices: prices };
}

//     ____  _____  ______ _   _    ____   _____ ______          _   _
//    / __ \|  __ \|  ____| \ | |  / __ \ / ____|  ____|   /\   | \ | |
//   | |  | | |__) | |__  |  \| | | |  | | |    | |__     /  \  |  \| |
//   | |  | |  ___/|  __| | . ` | | |  | | |    |  __|   / /\ \ | . ` |
//   | |__| | |    | |____| |\  | | |__| | |____| |____ / ____ \| |\  |
//    \____/|_|    |______|_| \_|  \____/ \_____|______/_/    \_\_| \_|
//
//

async function GetOpenOceanPriceMulti(tokens: TokenConfig[]): Promise<PriceResult> {
  const prices: { [tokenAddress: string]: number } = {};

  try {
    const url = 'https://open-api.openocean.finance/v3/arbitrum/tokenList';
    const openOceanResponse = await HttpGet<TokenListResponse>(url, undefined, 3);

    for (const token of tokens) {
      if (token.openoceanId) {
        const foundAsset = openOceanResponse.data.find((_) => _.id == token.openoceanId);

        if (foundAsset) {
          prices[token.address] = Number(foundAsset.usd);
        } else {
          prices[token.address] = 0;
        }

        Log(`GetOpenOceanPriceMulti: price for ${token.symbol} from openocean: $${prices[token.address]}`);
      }
    }
  } catch (e) {
    Warn('Exception calling coincap price api', e);
    for (const token of tokens) {
      if (token.coingeckoId) {
        prices[token.address] = 0;

        Log(`GetOpenOceanPriceMulti: price for ${token.symbol} from openocean: $${prices[token.address]}`);
      }
    }
  }

  return { source: 'OpenOcean', prices: prices };
}

//    _____  ________   __   _____ _    _ _____  _    _
//   |  __ \|  ____\ \ / /  / ____| |  | |  __ \| |  | |
//   | |  | | |__   \ V /  | |  __| |  | | |__) | |  | |
//   | |  | |  __|   > <   | | |_ | |  | |  _  /| |  | |
//   | |__| | |____ / . \  | |__| | |__| | | \ \| |__| |
//   |_____/|______/_/ \_\  \_____|\____/|_|  \_\\____/
//
//

async function GetDexGuruPriceMulti(tokens: TokenConfig[]): Promise<PriceResult> {
  const prices: { [tokenAddress: string]: number } = {};

  try {
    const tokenAddresses = tokens.map((_) => _.mainnetAddress || _.address);
    const chainid = NETWORK == 'ARBITRUM' ? 42161 : 1;
    const url =
      `https://api.dev.dex.guru/v1/chain/${chainid}/tokens/market?` +
      `token_addresses=${tokenAddresses.join(',')}` +
      '&limit=100';

    const config = {
      headers: {
        accept: 'application/json',
        'api-key': process.env.DEX_GURU_API_KEY
      }
    };

    const dexGuruResponse = await HttpGet<DexGuruTokensResponse>(url, config, 3);

    for (const token of tokens) {
      const foundAsset = dexGuruResponse.data.find(
        (_) => _.address.toLowerCase() == (token.mainnetAddress || token.address).toLowerCase()
      );

      if (foundAsset) {
        prices[token.address] = foundAsset.price_usd;
      } else {
        prices[token.address] = 0;
      }

      Log(`GetDexGuruPriceMulti: price for ${token.symbol} from dex guru: $${prices[token.address]}`);
    }
  } catch (e) {
    Warn('Exception calling DexGuru price api', e);
    for (const token of tokens) {
      if (token.coingeckoId) {
        prices[token.address] = 0;

        Log(`GetDexGuruPriceMulti: price for ${token.symbol} from dex guru: $${prices[token.address]}`);
      }
    }
  }

  return { source: 'DexGuru', prices: prices };
}

//    __ _____ _   _  _____ _    _
//   /_ |_   _| \ | |/ ____| |  | |
//    | | | | |  \| | |    | |__| |
//    | | | | | . ` | |    |  __  |
//    | |_| |_| |\  | |____| |  | |
//    |_|_____|_| \_|\_____|_|  |_|
//
//

async function GetOneInchPriceMulti(tokens: TokenConfig[]): Promise<PriceResult> {
  const prices: { [tokenAddress: string]: number } = {};

  try {
    const tokenAddresses = tokens.map((_) => _.mainnetAddress || _.address);
    const chainid = NETWORK == 'ARBITRUM' ? 42161 : 1;
    const url = `https://api.1inch.dev/price/v1.1/${chainid}/${tokenAddresses.join(',')}`;

    const config = {
      headers: {
        Authorization: `Bearer ${process.env.ONE_INCH_API_KEY}`
      },
      params: {
        currency: 'USD'
      }
    };
    const oneInchPriceResponse = await HttpGet<{ [tokenAddress: string]: string }>(url, config, 3);

    for (const token of tokens) {
      const foundPrice = oneInchPriceResponse[(token.mainnetAddress || token.address).toLowerCase()];

      if (foundPrice != undefined) {
        prices[token.address] = Number(foundPrice);
      } else {
        prices[token.address] = 0;
      }

      Log(`GetOneInchPriceMulti: price for ${token.symbol} from 1inch: $${prices[token.address]}`);
    }
  } catch (e) {
    Warn('Exception calling 1inch price api', e);
    for (const token of tokens) {
      if (token.coingeckoId) {
        prices[token.address] = 0;

        Log(`GetOneInchPriceMulti: price for ${token.symbol} from 1inch: $${prices[token.address]}`);
      }
    }
  }

  return { source: '1INCH', prices: prices };
}
