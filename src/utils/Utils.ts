import { readFileSync } from 'fs';
import { NodeConfig } from '../model/NodeConfig';
import { DATA_DIR, ECG_NODE_CONFIG_FULL_FILENAME, EXPLORER_URI } from './Constants';
import fs from 'fs';
import path from 'path';
import { ProtocolData, ProtocolDataFileStructure } from '../model/ProtocolData';
import { Log } from './Logger';
import axios from 'axios';

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
  if (!fs.existsSync(path.dirname(filename))) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
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
    Log(`WaitUntilScheduled: sleeping ${timeToSleepSec} seconds`);
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
  incrSleepDelay = 1000,
  retryCount = 1
): Promise<Awaited<ReturnType<T>>> {
  const currRetry = typeof retryCount === 'number' ? retryCount : 1;
  try {
    const result = await fn(...args);
    return result;
  } catch (e) {
    if (currRetry >= maxTry) {
      Log(`Retry ${currRetry} failed. All ${maxTry} retry attempts exhausted`);
      throw e;
    }

    if (axios.isAxiosError(e)) {
      // Access to config, request, and response
      Log(
        `Retry ${currRetry} failed calling ${e.request.protocol}//${e.request.host}/${e.request.path}: ${e}. Waiting ${retryCount} second(s)`
      );
    } else {
      Log(`Retry ${currRetry} failed: ${e}. Waiting ${retryCount} second(s)`);
    }
    // Log(e);
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
  Log(`GetProtocolData: last update ${protocolDataFile.updatedHuman}`);

  if (protocolDataFile.updated < Date.now() - 2 * 3600 * 1000) {
    throw new Error(`Protocol data outdated: ${protocolDataFile.updatedHuman}`);
  } else {
    return protocolDataFile.data;
  }
}

export function truncateString(value: string, maxLen = 1000) {
  if (value.length >= maxLen) {
    return value.substring(0, maxLen - 1);
  }

  return value;
}
