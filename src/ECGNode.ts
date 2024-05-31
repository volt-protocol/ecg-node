import fs from 'fs';
import path from 'path';
import { DATA_DIR, MARKET_ID } from './utils/Constants';
import { FetchECGData, FetchIfTooOld } from './datafetch/ECGDataFetcher';
import { StartEventProcessor } from './datafetch/EventProcessor';
import { StartEventListener } from './datafetch/EventWatcher';
import { spawn } from 'node:child_process';
import { NodeConfig } from './model/NodeConfig';
import { GetNodeConfig, sleep } from './utils/Utils';
import * as dotenv from 'dotenv';
import logger, { Log } from './utils/Logger';
import { LoadConfiguration } from './config/Config';
dotenv.config();

async function main() {
  process.title = 'ECG_NODE';
  logger.info(`[ECG-NODE] STARTED FOR MARKET_ID: ${MARKET_ID}`);
  logger.debug(`[ECG-NODE] STARTED FOR MARKET_ID: ${MARKET_ID}`);
  if (!fs.existsSync(path.join(DATA_DIR))) {
    fs.mkdirSync(path.join(DATA_DIR), { recursive: true });
  }

  await sleep(10000);
  logger.info(`NEW TESTING LOKI 1`);
  await sleep(10000);
  logger.info(`NEW TESTING LOKI 2`);
  await sleep(10000);
  await sleep(10000);
  await sleep(10000);

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
  if (nodeConfig.processors.AUCTION_BIDDER.enabled) {
    startWithSpawn('AuctionBidder', 'ECG_NODE_AUCTION_BIDDER');
    await sleep(5000);
  }
  if (nodeConfig.processors.LOAN_CALLER.enabled) {
    startWithSpawn('LoanCaller', 'ECG_NODE_LOAN_CALLER');
    await sleep(5000);
  }
  if (nodeConfig.processors.TERM_OFFBOARDER.enabled) {
    startWithSpawn('TermOffboarder', 'ECG_NODE_TERM_OFFBOARDER');
    await sleep(5000);
  }
  if (nodeConfig.processors.USER_SLASHER.enabled) {
    startWithSpawn('UserSlasher', 'ECG_NODE_USER_SLASHER');
    await sleep(5000);
  }
  // if (nodeConfig.processors.TERM_ONBOARDING_WATCHER.enabled) {
  //   startWithSpawn('TermOnboardingWatcher');
  //   await sleep(5000);
  // }
  if (nodeConfig.processors.TESTNET_MARKET_MAKER.enabled) {
    startWithSpawn('TestnetMarketMaker', 'ECG_NODE_TESTNET_MARKET_MAKER');
    await sleep(5000);
  }
  if (nodeConfig.processors.HISTORICAL_DATA_FETCHER.enabled) {
    startWithSpawn('HistoricalDataFetcher', 'ECG_NODE_HISTORICAL_DATA_FETCHER');
    await sleep(5000);
  }
}

function startWithSpawn(processorName: string, appName: string) {
  const nodeProcessFullPath = path.join(process.cwd(), 'processors', `${processorName}.js`);
  Log(`Starting ${nodeProcessFullPath}`);
  const updatedEnv = structuredClone(process.env);
  updatedEnv.APP_NAME = appName;
  const child = spawn('node', [nodeProcessFullPath], { stdio: 'inherit', env: updatedEnv });

  child.on('close', (code) => {
    Log(`Child process exited with code ${code}. Restarting after 10sec`);
    setTimeout(() => startWithSpawn(processorName, appName), 10000);
  });

  Log(`Started ${nodeProcessFullPath}`);
}
main();
