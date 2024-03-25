import { MARKET_ID } from './Constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Log(msg: string, ...args: any[]) {
  console.log(`[${process.title}] | MARKET ${MARKET_ID} | ${msg}`, ...args);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Warn(msg: string, ...args: any[]) {
  console.warn(`[${process.title}] | MARKET ${MARKET_ID} | ${msg}`, ...args);
}
