import { MARKET_ID } from './Constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Log(msg: string, ...args: any[]) {
  const marketId = process.env.MARKET_ID;
  if (marketId) {
    console.log(`[${process.title}] | MARKET ${marketId} | ${msg}`, ...args);
  } else {
    console.log(`[${process.title}] | ${msg}`, ...args);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Warn(msg: string, ...args: any[]) {
  const marketId = process.env.MARKET_ID;
  if (marketId) {
    console.warn(`[${process.title}] | MARKET ${marketId} | ${msg}`, ...args);
  } else {
    console.warn(`[${process.title}] | ${msg}`, ...args);
  }
}
