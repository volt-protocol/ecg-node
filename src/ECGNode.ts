import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './utils/Constants';
import { FetchECGData, FetchIfTooOld } from './datafetch/ECGDataFetcher';
import { StartEventProcessor } from './datafetch/EventProcessor';
import { StartEventListener } from './datafetch/EventWatcher';
import { spawn } from 'node:child_process';
import { NodeConfig } from './model/NodeConfig';
import { GetNodeConfig, sleep } from './utils/Utils';
import * as dotenv from 'dotenv';
import { Log } from './utils/Logger';
import { LoadConfiguration } from './config/Config';
dotenv.config();

async function main() {
  process.title = 'ECG_NODE';
  Log('[ECG-NODE] STARTED');
  if (!fs.existsSync(path.join(DATA_DIR))) {
    fs.mkdirSync(path.join(DATA_DIR), { recursive: true });
  }

  // load external config
  await LoadConfiguration();

  // load configuration from working dir
  const nodeConfig = GetNodeConfig();

  await FetchECGData();

  // set a timeout to check if the last fetch was performed recently and fetch if needed
  setInterval(async () => await FetchIfTooOld(), 60000);
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
  if (nodeConfig.processors.TERM_ONBOARDING_WATCHER.enabled) {
    startWithSpawn('TermOnboardingWatcher');
    await sleep(5000);
  }
  if (nodeConfig.processors.USER_SLASHER.enabled) {
    startWithSpawn('UserSlasher');
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
