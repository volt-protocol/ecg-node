import fs from 'fs';
import path from 'path';
import {
  AUCTION_BIDDER_ENABLED,
  DATA_DIR,
  HISTORICAL_DATA_FETCHER_ENABLED,
  LOAN_CALLER_ENABLED,
  MARKET_ID,
  TERM_OFFBOARDER_ENABLED,
  TESTNET_MARKET_MAKER_ENABLED,
  USER_SLASHER_ENABLED
} from './utils/Constants';
import { FetchECGData, FetchIfTooOld } from './datafetch/ECGDataFetcher';
import { StartEventProcessor } from './datafetch/EventProcessor';
import { spawn } from 'node:child_process';
import { NodeConfig } from './model/NodeConfig';
import { sleep } from './utils/Utils';
import * as dotenv from 'dotenv';
import { Log } from './utils/Logger';
import { GetNodeConfig } from './config/Config';
import { StartUniversalEventListener } from './datafetch/EventWatcher';
dotenv.config();

async function main() {
  process.title = 'ECG_NODE';
  Log(`[ECG-NODE] STARTED FOR MARKET_ID: ${MARKET_ID}`);
  if (!fs.existsSync(path.join(DATA_DIR))) {
    fs.mkdirSync(path.join(DATA_DIR), { recursive: true });
  }

  // load configuration from working dir
  const nodeConfig = await GetNodeConfig();

  await FetchECGData();

  // set a timeout to check if the last fetch was performed recently and fetch if needed
  setInterval(async () => await FetchIfTooOld(), 60000);
  StartUniversalEventListener();
  StartEventProcessor();

  // only start processors if running in production
  if (!isDebug()) {
    startProcessors(nodeConfig);
  }
}

/**
 * Check if the process is in debug mode: aka launching a .ts file
 */
function isDebug() {
  return process.argv[1].endsWith('.ts');
}

async function startProcessors(nodeConfig: NodeConfig) {
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
