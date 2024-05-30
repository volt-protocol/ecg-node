import { Log } from '../../utils/Logger';

const cache: SimpleCache = {};

interface SimpleCache {
  [key: string]: SimpleCacheItem;
}

interface SimpleCacheItem {
  expirationTimestamp: number; // in ms
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cachedItem: any;
}

export default class SimpleCacheService {
  static Get<T>(key: string): T | null {
    if (cache[key] && cache[key].expirationTimestamp > Date.now()) {
      return cache[key].cachedItem as T;
    } else {
      return null;
    }
  }

  static Set<T>(key: string, item: T, cacheDurationMs: number) {
    cache[key] = {
      cachedItem: item,
      expirationTimestamp: Date.now() + cacheDurationMs
    };
  }

  // get the data from cache, using the function in parameter to get the data if not in cache
  static async GetAndCache<T>(key: string, fct: () => Promise<T>, cacheDurationMs: number): Promise<T> {
    let cached = SimpleCacheService.Get<T>(key);
    if (!cached) {
      // Log(`CACHE MISS FOR ${key}`);
      cached = await fct();
      SimpleCacheService.Set<T>(key, cached, cacheDurationMs);
    } else {
      // Log(`CACHE HIT FOR ${key}`);
    }

    return cached;
  }
}
