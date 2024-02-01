import { WaitUntilScheduled, retry } from '../utils/Utils';

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../utils/Constants';
import { ethers } from 'ethers';
import { GetCreditTokenAddress, GetDeployBlock } from '../config/Config';
import { HistoricalData } from '../model/HistoricalData';
import { CreditToken__factory } from '../contracts/types';
import { norm } from '../utils/TokenUtils';
import * as dotenv from 'dotenv';
import { GetBlock } from '../utils/Web3Helper';
dotenv.config();

const runEverySec = 30 * 60; // every 30 minutes
const STEP_BLOCK = 277;

/**
 * Fetches data historically since the protocol deployment, 1 data per hour for a selected data
 * Assumes 1 block = 13 seconds so fetches data for every 277 blocks
 */
async function HistoricalDataFetcher() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'HISTORICAL_DATA_FETCHER';
    const startDate = Date.now();
    console.log('HistoricalDataFetcher: starting');
    const rpcURL = process.env.RPC_URL;
    if (!rpcURL) {
      throw new Error('Cannot find RPC_URL in env');
    }
    const web3Provider = new ethers.JsonRpcProvider(rpcURL);
    const currentBlock = await web3Provider.getBlockNumber();
    console.log(`FetchECGData: fetching data up to block ${currentBlock}`);

    const historicalDataDir = path.join(DATA_DIR, 'history');

    if (!fs.existsSync(historicalDataDir)) {
      fs.mkdirSync(historicalDataDir, { recursive: true });
    }

    await fetchCreditTotalSupply(currentBlock, historicalDataDir, web3Provider);

    await WaitUntilScheduled(startDate, runEverySec);
  }
}

async function fetchCreditTotalSupply(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider
) {
  let startBlock = GetDeployBlock();
  const historyFilename = path.join(historicalDataDir, 'credit-supply.json');
  let fullHistoricalData: HistoricalData = {
    name: 'credit-supply',
    values: {},
    blockTimes: {}
  };

  if (fs.existsSync(historyFilename)) {
    fullHistoricalData = JSON.parse(fs.readFileSync(historyFilename, 'utf-8'));
    startBlock = Number(Object.keys(fullHistoricalData.values).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    console.log('No data to fetch');
    return;
  }

  const creditTokenContract = CreditToken__factory.connect(GetCreditTokenAddress(), web3Provider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    const totalSupplyAtBlock = await creditTokenContract.totalSupply({ blockTag: blockToFetch });
    const blockData = await retry(GetBlock, [web3Provider, blockToFetch]);
    fullHistoricalData.values[blockToFetch] = norm(totalSupplyAtBlock);
    fullHistoricalData.blockTimes[blockToFetch] = blockData.timestamp;
    console.log(
      `fetchCreditTotalSupply: [${blockToFetch}] (${new Date(
        blockData.timestamp * 1000
      ).toISOString()}) total supply : ${fullHistoricalData.values[blockToFetch]}`
    );
  }

  fs.writeFileSync(historyFilename, JSON.stringify(fullHistoricalData));
}

HistoricalDataFetcher();
