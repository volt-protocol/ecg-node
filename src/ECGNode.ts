import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './utils/Constants';
import { FetchECGData, FetchIfTooOld } from './datafetch/ECGDataFetcher';
import { StartEventProcessor } from './datafetch/EventProcessor';
import { StartEventListener } from './datafetch/EventWatcher';
import { spawn } from 'node:child_process';
import { NodeConfig } from './model/NodeConfig';
import * as dotenv from 'dotenv';
import { GetNodeConfig, sleep } from './utils/Utils';
dotenv.config();

async function main() {
  process.title = 'ECG_NODE';
  console.log('[ECG-NODE] STARTED');
  if (!fs.existsSync(path.join(DATA_DIR))) {
    fs.mkdirSync(path.join(DATA_DIR), { recursive: true });
  }

  // load configuration from working dir
  const nodeConfig = GetNodeConfig();

  await FetchECGData();

  // set a timeout to check if the last fetch was performed recently and fetch if needed
  setTimeout(async () => await FetchIfTooOld(), 60000);
  StartEventListener();
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
  if (nodeConfig.processors.HISTORICAL_DATA_FETCHER.enabled) {
    startWithSpawn('HistoricalDataFetcher');
    await sleep(5000);
  }
  if (nodeConfig.processors.TERM_OFFBOARDER.enabled) {
    startWithSpawn('TermOffboarder');
    await sleep(5000);
  }
  if (nodeConfig.processors.LOAN_CALLER.enabled) {
    startWithSpawn('LoanCaller');
    await sleep(5000);
  }
  if (nodeConfig.processors.AUCTION_BIDDER.enabled) {
    startWithSpawn('AuctionBidder');
    await sleep(5000);
  }
  if (nodeConfig.processors.TESTNET_MARKET_MAKER.enabled) {
    startWithSpawn('TestnetMarketMaker');
    await sleep(5000);
  }
  if (nodeConfig.processors.NEW_TERMS_WATCHER.enabled) {
    startWithSpawn('NewTermsWatcher');
    await sleep(5000);
  }
  if (nodeConfig.processors.USER_SLASHER.enabled) {
    startWithSpawn('UserSlasher');
    await sleep(5000);
  }
}

function startWithSpawn(processorName: string) {
  const nodeProcessFullPath = path.join(process.cwd(), 'processors', `${processorName}.js`);
  console.log(`Starting ${nodeProcessFullPath}`);
  const child = spawn('node', [nodeProcessFullPath], { stdio: 'inherit' });

  child.on('close', (code) => {
    console.log(`Child process exited with code ${code}. Restarting after 10sec`);
    setTimeout(() => startWithSpawn(processorName), 10000);
  });

  console.log(`Started ${nodeProcessFullPath}`);
}
main();
