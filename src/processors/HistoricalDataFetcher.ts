import { WaitUntilScheduled, retry } from '../utils/Utils';

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../utils/Constants';
import { ethers } from 'ethers';
import { GetCreditTokenAddress, GetDeployBlock, GetGuildTokenAddress, GetProfitManagerAddress } from '../config/Config';
import { HistoricalData } from '../model/HistoricalData';
import {
  CreditToken__factory,
  GuildToken__factory,
  LendingTerm,
  LendingTerm__factory,
  ProfitManager__factory
} from '../contracts/types';
import { norm } from '../utils/TokenUtils';
import * as dotenv from 'dotenv';
import { GetBlock } from '../utils/Web3Helper';
import { MulticallWrapper } from 'ethers-multicall-provider';
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
    await fetchCreditTotalIssuance(currentBlock, historicalDataDir, web3Provider);
    await fetchAverageInterestRate(currentBlock, historicalDataDir, web3Provider);

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
    console.log('fetchCreditTotalSupply: data already up to date');
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

async function fetchCreditTotalIssuance(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider
) {
  let startBlock = GetDeployBlock();
  const historyFilename = path.join(historicalDataDir, 'credit-total-issuance.json');
  let fullHistoricalData: HistoricalData = {
    name: 'credit-total-issuance',
    values: {},
    blockTimes: {}
  };

  if (fs.existsSync(historyFilename)) {
    fullHistoricalData = JSON.parse(fs.readFileSync(historyFilename, 'utf-8'));
    startBlock = Number(Object.keys(fullHistoricalData.values).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    console.log('fetchCreditTotalIssuance: data already up to date');
    return;
  }

  const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), web3Provider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    const totalIssuanceAtBlock = await profitManagerContract.totalIssuance({ blockTag: blockToFetch });
    const blockData = await retry(GetBlock, [web3Provider, blockToFetch]);
    fullHistoricalData.values[blockToFetch] = norm(totalIssuanceAtBlock);
    fullHistoricalData.blockTimes[blockToFetch] = blockData.timestamp;
    console.log(
      `fetchCreditTotalIssuance: [${blockToFetch}] (${new Date(
        blockData.timestamp * 1000
      ).toISOString()}) total issuance : ${fullHistoricalData.values[blockToFetch]}`
    );
  }

  fs.writeFileSync(historyFilename, JSON.stringify(fullHistoricalData));
}

async function fetchAverageInterestRate(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider
) {
  const multicallProvider = MulticallWrapper.wrap(web3Provider);

  let startBlock = GetDeployBlock();
  const historyFilename = path.join(historicalDataDir, 'average-interest-rate.json');
  let fullHistoricalData: HistoricalData = {
    name: 'average-interest-rate',
    values: {},
    blockTimes: {}
  };

  if (fs.existsSync(historyFilename)) {
    fullHistoricalData = JSON.parse(fs.readFileSync(historyFilename, 'utf-8'));
    startBlock = Number(Object.keys(fullHistoricalData.values).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    console.log('fetchAverageInterestRate: data already up to date');
    return;
  }

  const guildContract = GuildToken__factory.connect(GetGuildTokenAddress(), multicallProvider);
  const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), multicallProvider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    const liveTerms = await guildContract.liveGauges({ blockTag: blockToFetch });
    const blockData = await retry(GetBlock, [web3Provider, blockToFetch]);

    const promises = [];
    promises.push(profitManagerContract.totalIssuance({ blockTag: blockToFetch }));

    for (const termAddress of liveTerms) {
      const termContract = LendingTerm__factory.connect(termAddress, multicallProvider);
      promises.push(termContract.getParameters({ blockTag: blockToFetch }));
      promises.push(termContract.issuance({ blockTag: blockToFetch }));
    }

    const promiseResults = await Promise.all(promises);

    let cursor = 0;
    const totalIssuance = norm(promiseResults[cursor++] as bigint);
    let avgInterestRate = 0;
    if (totalIssuance != 0) {
      for (const termAddress of liveTerms) {
        const parameters = promiseResults[cursor++] as LendingTerm.LendingTermParamsStructOutput;
        const issuance = norm(promiseResults[cursor++] as bigint);

        avgInterestRate += (norm(parameters.interestRate) * issuance) / totalIssuance;
      }

      fullHistoricalData.values[blockToFetch] = avgInterestRate;
    }

    fullHistoricalData.values[blockToFetch] = avgInterestRate;
    fullHistoricalData.blockTimes[blockToFetch] = blockData.timestamp;

    console.log(
      `fetchAverageInterestRate: [${blockToFetch}] (${new Date(
        blockData.timestamp * 1000
      ).toISOString()}) avg interest rate : ${fullHistoricalData.values[blockToFetch]}`
    );
  }

  fs.writeFileSync(historyFilename, JSON.stringify(fullHistoricalData));
}

HistoricalDataFetcher();
