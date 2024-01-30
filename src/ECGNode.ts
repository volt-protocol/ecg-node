import fs from 'fs';
import path from 'path';
import { DATA_DIR, ECG_NODE_CONFIG_FULL_FILENAME } from './utils/Constants';
import { FetchECGData } from './datafetch/ECGDataFetcher';
import { StartEventProcessor } from './datafetch/EventProcessor';
import { StartEventListener } from './datafetch/EventWatcher';
import { spawn } from 'node:child_process';
import { NodeConfig } from './model/NodeConfig';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  process.title = 'ECG_NODE';
  console.log('[ECG-NODE] STARTED');
  if (!fs.existsSync(path.join(DATA_DIR))) {
    fs.mkdirSync(path.join(DATA_DIR), { recursive: true });
  }

  // load configuration from working dir
  const nodeConfig: NodeConfig = JSON.parse(fs.readFileSync(ECG_NODE_CONFIG_FULL_FILENAME, 'utf-8'));

  await FetchECGData();

  // set a timeout that fetches ecg data every 30 minutes
  setTimeout(async () => await FetchECGData(), 30 * 60 * 1000);
  StartEventListener();
  StartEventProcessor();

  // only start processors if running from node and not ts-node
  // if ts-node, it means we are debugging
  // to debug a processor, run the processor directly
  if (!isDebug()) {
    startProcessors(nodeConfig);
  }
}

/**
 * Check if the process is started by node (and not ts-node)
 * meaning it's started not in debug
 * @returns false if started by 'node'
 */
function isDebug() {
  console.log(process.argv);
  const starterProcess = path.basename(process.argv[0]).split('.')[0];
  console.log({ starterProcess });
  const isDebug = starterProcess != 'node';

  return isDebug;
}

function startProcessors(nodeConfig: NodeConfig) {
  if (nodeConfig.processors.HISTORICAL_DATA_FETCHER.enabled) {
    startWithSpawn('HistoricalDataFetcher');
  }

  // if (nodeConfig.processors.LOAN_CALLER.enabled) {
  //   startWithSpawn('LoanCaller');
  // }
  // if (nodeConfig.processors.AUCTION_BIDDER.enabled) {
  //   startWithSpawn('AuctionBidder');
  // }
  // if (nodeConfig.processors.NEW_TERMS_WATCHER.enabled) {
  //   startWithSpawn('NewTermsWatcher');
  // }
  // if (nodeConfig.processors.TERM_OFFBOARDER.enabled) {
  //   startWithSpawn('TermOffboarder');
  // }
  // if (nodeConfig.processors.USER_SLASHER.enabled) {
  //   startWithSpawn('UserSlasher');
  // }
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
