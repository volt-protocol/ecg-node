import { readFileSync } from 'fs';
import { NodeConfig } from '../model/NodeConfig';
import { DATA_DIR, ECG_NODE_CONFIG_FULL_FILENAME, EXPLORER_URI } from './Constants';
import fs from 'fs';
import path from 'path';
import { ProtocolData, ProtocolDataFileStructure } from '../model/ProtocolData';

export function JsonBigIntReplacer(key: string, value: any) {
  if (typeof value === 'bigint') {
    return value.toString() + 'n';
  }
  return value;
}

export function JsonBigIntReviver(key: string, value: any) {
  if (typeof value === 'string' && /^\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }
  return value;
}

export function ReadJSON(filename: string) {
  return JSON.parse(fs.readFileSync(filename, 'utf-8'), JsonBigIntReviver);
}

export function WriteJSON(filename: string, obj: any) {
  fs.writeFileSync(filename, JSON.stringify(obj, JsonBigIntReplacer, 2));
}

/**
 * sleep
 * @param {number} ms milliseconds to sleep
 * @returns async promise
 */
export async function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function buildTxUrl(txhash: string): string {
  return `${EXPLORER_URI}/tx/${txhash}`;
}

export async function WaitUntilScheduled(startDateMs: number, runEverySec: number) {
  const now = Date.now();
  const durationSec = (now - startDateMs) / 1000;
  const timeToSleepSec = runEverySec - durationSec;
  if (timeToSleepSec > 0) {
    console.log(`WaitUntilScheduled: sleeping ${timeToSleepSec} seconds`);
    await sleep(timeToSleepSec * 1000);
  }
}

export function roundTo(num: number, dec: number): number {
  const pow = Math.pow(10, dec);
  return Math.round((num + Number.EPSILON) * pow) / pow;
}

/**
 * Retries a function n number of times before giving up
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function retry<T extends (...arg0: any[]) => any>(
  fn: T,
  args: Parameters<T>,
  maxTry = 10,
  incrSleepDelay = 10000,
  retryCount = 1
): Promise<Awaited<ReturnType<T>>> {
  const currRetry = typeof retryCount === 'number' ? retryCount : 1;
  try {
    const result = await fn(...args);
    return result;
  } catch (e) {
    if (currRetry >= maxTry) {
      console.log(`Retry ${currRetry} failed. All ${maxTry} retry attempts exhausted`);
      throw e;
    }
    console.log(`Retry ${currRetry} failed: ${e}`);
    // console.log(e);
    console.log(`Waiting ${retryCount} second(s)`);
    await sleep(incrSleepDelay * retryCount);
    return retry(fn, args, maxTry, incrSleepDelay, currRetry + 1);
  }
}

export function GetNodeConfig() {
  const nodeConfig: NodeConfig = ReadJSON(ECG_NODE_CONFIG_FULL_FILENAME);
  return nodeConfig;
}

export function GetProtocolData(): ProtocolData {
  const protocolDataFilename = path.join(DATA_DIR, 'protocol-data.json');

  const protocolDataFile = ReadJSON(protocolDataFilename) as ProtocolDataFileStructure;
  console.log(`GetProtocolData: last update ${protocolDataFile.updatedHuman}`);

  if (protocolDataFile.updated < Date.now() - 2 * 3600 * 1000) {
    throw new Error('Protocol data outdated');
  } else {
    return protocolDataFile.data;
  }
}
