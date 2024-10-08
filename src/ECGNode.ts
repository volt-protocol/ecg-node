import fs from 'fs';
import path from 'path';
import {
  AUCTION_BIDDER_ENABLED,
  DATA_DIR,
  getProcessTitleMarketId,
  HISTORICAL_DATA_FETCHER_ENABLED,
  LOAN_CALLER_ENABLED,
  MARKET_ID,
  TERM_OFFBOARDER_ENABLED,
  TESTNET_MARKET_MAKER_ENABLED,
  USER_SLASHER_ENABLED
} from './utils/Constants';
import { FetchECGData, FetchIfTooOld } from './datafetch/ECGDataFetcher';
import { StartEventProcessor } from './datafetch/EventProcessor';
import { spawn, exec } from 'node:child_process';
import { sleep } from './utils/Utils';
import * as dotenv from 'dotenv';
import { Log } from './utils/Logger';
import { StartUniversalEventListener } from './datafetch/EventWatcher';
dotenv.config();

async function main() {
  process.title = `${getProcessTitleMarketId()}`;
  Log(`[ECG-NODE] STARTED FOR MARKET_ID: ${MARKET_ID}`);
  if (!fs.existsSync(path.join(DATA_DIR))) {
    fs.mkdirSync(path.join(DATA_DIR), { recursive: true });
  }

  await FetchECGData();

  // set a timeout to check if the last fetch was performed recently and fetch if needed
  setInterval(async () => await FetchIfTooOld(), 60000);
  StartUniversalEventListener();
  StartEventProcessor();

  // only start processors if running in production
  if (!isDebug()) {
    startProcessors();
  }
}

/**
 * Check if the process is in debug mode: aka launching a .ts file
 */
function isDebug() {
  return process.argv[1].endsWith('.ts');
}

async function startProcessors() {
  if (AUCTION_BIDDER_ENABLED) {
    startWithSpawn('AuctionBidder');
    await sleep(5000);
  }
  if (LOAN_CALLER_ENABLED) {
    startWithSpawn('LoanCaller');
    await sleep(5000);
  }
  if (TERM_OFFBOARDER_ENABLED) {
    startWithSpawn('TermOffboarder');
    await sleep(5000);
  }
  if (USER_SLASHER_ENABLED) {
    startWithSpawn('UserSlasher');
    await sleep(5000);
  }
  // if (nodeConfig.processors.TERM_ONBOARDING_WATCHER.enabled) {
  //   startWithSpawn('TermOnboardingWatcher');
  //   await sleep(5000);
  // }
  if (TESTNET_MARKET_MAKER_ENABLED) {
    startWithSpawn('TestnetMarketMaker');
    await sleep(5000);
  }
  if (HISTORICAL_DATA_FETCHER_ENABLED) {
    startWithSpawn('HistoricalDataFetcher');
    await sleep(5000);
  }
}

function startWithSpawn(processorName: string) {
  Log(`Killall ${process.title}_${processorName}`);
  exec(`killall ${process.title}_${processorName}`);

  const nodeProcessFullPath = path.join(process.cwd(), 'processors', `${processorName}.js`);
  Log(`Starting ${nodeProcessFullPath}`);
  const child = spawn('node', [nodeProcessFullPath], { stdio: 'inherit' });

  child.on('close', (code) => {
    Log(`Child process exited with code ${code}. Restarting after 10sec`);
    setTimeout(() => startWithSpawn(processorName), 10000);
  });

  Log(`Started ${nodeProcessFullPath}`);
}
main();

// handle exit cases
process
  .on('unhandledRejection', (err) => {
    Log('Exit process (unhandled rejection)', err);
  })
  .on('uncaughtException', (err) => {
    Log('Exit process (uncaught exception)', err);
  })
  .on('message', (message) => {
    if (message === 'shutdown') {
      Log('Exit process (shutdown message)');
    }
  })
  .once('exit', () => {
    Log('Exit process (exit)');
  })
  .once('beforeExit', () => {
    Log('Exit process (beforeExit)');
  })
  .once('SIGINT', () => {
    Log('Exit process (SIGINT)');
  })
  .once('SIGTERM', () => {
    Log('Exit process (SIGTERM)');
  });
