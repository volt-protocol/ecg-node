import { ReadJSON, WaitUntilScheduled, WriteJSON, retry } from '../utils/Utils';

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../utils/Constants';
import { ethers } from 'ethers';
import {
  GetCreditTokenAddress,
  GetDeployBlock,
  GetGuildTokenAddress,
  GetProfitManagerAddress,
  getTokenByAddress
} from '../config/Config';
import { HistoricalData, HistoricalDataMulti } from '../model/HistoricalData';
import {
  CreditToken__factory,
  ERC20__factory,
  GuildToken__factory,
  LendingTerm,
  LendingTerm__factory,
  ProfitManager__factory
} from '../contracts/types';
import { norm } from '../utils/TokenUtils';
import * as dotenv from 'dotenv';
import { GetBlock, GetWeb3Provider } from '../utils/Web3Helper';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { GetTokenPriceAtTimestamp } from '../utils/Price';
dotenv.config();

const runEverySec = 30 * 60; // every 30 minutes
const STEP_BLOCK = 277;

const web3Provider = GetWeb3Provider();
/**
 * Fetches data historically since the protocol deployment, 1 data per hour for a selected data
 * Assumes 1 block = 13 seconds so fetches data for every 277 blocks
 */
async function HistoricalDataFetcher() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'HISTORICAL_DATA_FETCHER';
    const startDate = Date.now();
    console.log('HistoricalDataFetcher | starting');
    const rpcURL = process.env.RPC_URL;
    if (!rpcURL) {
      throw new Error('Cannot find RPC_URL in env');
    }
    const currentBlock = await web3Provider.getBlockNumber();
    console.log(`HistoricalDataFetcher | fetching data up to block ${currentBlock}`);

    const historicalDataDir = path.join(DATA_DIR, 'history');

    if (!fs.existsSync(historicalDataDir)) {
      fs.mkdirSync(historicalDataDir, { recursive: true });
    }

    await fetchCreditTotalSupply(currentBlock, historicalDataDir, web3Provider);
    await fetchCreditTotalIssuance(currentBlock, historicalDataDir, web3Provider);
    await fetchAverageInterestRate(currentBlock, historicalDataDir, web3Provider);
    await fetchTVL(currentBlock, historicalDataDir, web3Provider);
    await fetchDebtCeilingAndIssuance(currentBlock, historicalDataDir, web3Provider);
    await fetchGaugeWeight(currentBlock, historicalDataDir, web3Provider);
    await fetchSurplusBuffer(currentBlock, historicalDataDir, web3Provider);

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
    fullHistoricalData = ReadJSON(historyFilename);
    startBlock = Number(Object.keys(fullHistoricalData.values).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    console.log('HistoricalDataFetcher | fetchCreditTotalSupply: data already up to date');
    return;
  }

  const creditTokenContract = CreditToken__factory.connect(GetCreditTokenAddress(), web3Provider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    const totalSupplyAtBlock = await creditTokenContract.totalSupply({ blockTag: blockToFetch });
    const blockData = await retry(GetBlock, [web3Provider, blockToFetch]);
    fullHistoricalData.values[blockToFetch] = norm(totalSupplyAtBlock);
    fullHistoricalData.blockTimes[blockToFetch] = blockData.timestamp;
    console.log(
      `HistoricalDataFetcher | fetchCreditTotalSupply: [${blockToFetch}] (${new Date(
        blockData.timestamp * 1000
      ).toISOString()}) total supply : ${fullHistoricalData.values[blockToFetch]}`
    );
  }

  WriteJSON(historyFilename, fullHistoricalData);
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
    fullHistoricalData = ReadJSON(historyFilename);
    startBlock = Number(Object.keys(fullHistoricalData.values).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    console.log('HistoricalDataFetcher | fetchCreditTotalIssuance: data already up to date');
    return;
  }

  const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), web3Provider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    const totalIssuanceAtBlock = await profitManagerContract.totalIssuance({ blockTag: blockToFetch });
    const blockData = await retry(GetBlock, [web3Provider, blockToFetch]);
    fullHistoricalData.values[blockToFetch] = norm(totalIssuanceAtBlock);
    fullHistoricalData.blockTimes[blockToFetch] = blockData.timestamp;
    console.log(
      `HistoricalDataFetcher | fetchCreditTotalIssuance: [${blockToFetch}] (${new Date(
        blockData.timestamp * 1000
      ).toISOString()}) total issuance : ${fullHistoricalData.values[blockToFetch]}`
    );
  }

  WriteJSON(historyFilename, fullHistoricalData);
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
    fullHistoricalData = ReadJSON(historyFilename);
    startBlock = Number(Object.keys(fullHistoricalData.values).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    console.log('HistoricalDataFetcher | fetchAverageInterestRate: data already up to date');
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
      `HistoricalDataFetcher | fetchAverageInterestRate: [${blockToFetch}] (${new Date(
        blockData.timestamp * 1000
      ).toISOString()}) avg interest rate : ${fullHistoricalData.values[blockToFetch]}`
    );
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

async function fetchTVL(currentBlock: number, historicalDataDir: string, web3Provider: ethers.JsonRpcProvider) {
  const multicallProvider = MulticallWrapper.wrap(web3Provider);

  let startBlock = GetDeployBlock();
  const historyFilename = path.join(historicalDataDir, 'tvl.json');
  let fullHistoricalData: HistoricalData = {
    name: 'tvl',
    values: {},
    blockTimes: {}
  };

  if (fs.existsSync(historyFilename)) {
    fullHistoricalData = ReadJSON(historyFilename);
    startBlock = Number(Object.keys(fullHistoricalData.values).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    console.log('HistoricalDataFetcher | fetchTVL: data already up to date');
    return;
  }

  const guildContract = GuildToken__factory.connect(GetGuildTokenAddress(), multicallProvider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    const liveTerms = await guildContract.liveGauges({ blockTag: blockToFetch });
    const blockData = await retry(GetBlock, [web3Provider, blockToFetch]);

    const collateralPromises = [];

    for (const termAddress of liveTerms) {
      const termContract = LendingTerm__factory.connect(termAddress, multicallProvider);
      collateralPromises.push(termContract.collateralToken({ blockTag: blockToFetch }));
    }

    const collateralResults = await Promise.all(collateralPromises);

    let cursor = 0;
    const balanceOfPromises = [];
    for (const termAddress of liveTerms) {
      const termCollateral = collateralResults[cursor++];
      const erc20Contract = ERC20__factory.connect(termCollateral, multicallProvider);
      balanceOfPromises.push(erc20Contract.balanceOf(termAddress, { blockTag: blockToFetch }));
    }

    const balanceOfResults = await Promise.all(balanceOfPromises);

    // here we have all the collaterals and the balances of each terms
    // we need to fetch the collateral price (historical) of each tokens
    cursor = 0;
    let tvlInUsd = 0;
    for (const collateralAddress of collateralResults) {
      const tokenConf = getTokenByAddress(collateralAddress);
      const balanceNorm = norm(balanceOfResults[cursor++], tokenConf.decimals);
      const priceAtTimestamp = await GetTokenPriceAtTimestamp(
        tokenConf.mainnetAddress || tokenConf.address,
        blockData.timestamp
      );
      const termTvl = priceAtTimestamp * balanceNorm;
      tvlInUsd += termTvl;
    }

    fullHistoricalData.values[blockToFetch] = tvlInUsd;
    fullHistoricalData.blockTimes[blockToFetch] = blockData.timestamp;

    console.log(
      `HistoricalDataFetcher | fetchTVL: [${blockToFetch}] (${new Date(
        blockData.timestamp * 1000
      ).toISOString()}) TVL : ${fullHistoricalData.values[blockToFetch]}`
    );
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

async function fetchDebtCeilingAndIssuance(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider
) {
  const multicallProvider = MulticallWrapper.wrap(web3Provider);

  let startBlock = GetDeployBlock();
  const historyFilename = path.join(historicalDataDir, 'debtceiling-issuance.json');
  let fullHistoricalData: HistoricalDataMulti = {
    name: 'debtceiling-issuance',
    values: {},
    blockTimes: {}
  };

  if (fs.existsSync(historyFilename)) {
    fullHistoricalData = ReadJSON(historyFilename);
    startBlock = Number(Object.keys(fullHistoricalData.values).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    console.log('HistoricalDataFetcher | fetchDebtCeilingAndIssuance: data already up to date');
    return;
  }

  const guildContract = GuildToken__factory.connect(GetGuildTokenAddress(), multicallProvider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    fullHistoricalData.values[blockToFetch] = {};
    const liveTerms = await guildContract.liveGauges({ blockTag: blockToFetch });
    const blockData = await retry(GetBlock, [web3Provider, blockToFetch]);

    const promises = [];

    for (const termAddress of liveTerms) {
      const termContract = LendingTerm__factory.connect(termAddress, multicallProvider);
      promises.push(termContract['debtCeiling()']({ blockTag: blockToFetch }));
      promises.push(termContract.issuance({ blockTag: blockToFetch }));
    }

    const results = await Promise.all(promises);

    let cursor = 0;
    let totalDebtCeiling = 0;
    let totalIssuance = 0;
    for (const termAddress of liveTerms) {
      const debtCeiling = results[cursor++];
      const issuance = results[cursor++];
      fullHistoricalData.values[blockToFetch][`${termAddress}-debtCeiling`] = norm(debtCeiling);
      fullHistoricalData.values[blockToFetch][`${termAddress}-issuance`] = norm(issuance);
      totalDebtCeiling += norm(debtCeiling);
      totalIssuance += norm(issuance);
    }

    fullHistoricalData.blockTimes[blockToFetch] = blockData.timestamp;

    console.log(
      `HistoricalDataFetcher | fetchDebtCeilingAndIssuance: [${blockToFetch}] (${new Date(
        blockData.timestamp * 1000
      ).toISOString()}) total debtCeiling: ${totalDebtCeiling} | total issuance: ${totalIssuance}`
    );
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

async function fetchGaugeWeight(currentBlock: number, historicalDataDir: string, web3Provider: ethers.JsonRpcProvider) {
  const multicallProvider = MulticallWrapper.wrap(web3Provider);

  let startBlock = GetDeployBlock();
  const historyFilename = path.join(historicalDataDir, 'gauge-weight.json');
  let fullHistoricalData: HistoricalDataMulti = {
    name: 'gauge-weight',
    values: {},
    blockTimes: {}
  };

  if (fs.existsSync(historyFilename)) {
    fullHistoricalData = ReadJSON(historyFilename);
    startBlock = Number(Object.keys(fullHistoricalData.values).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    console.log('HistoricalDataFetcher | fetchGaugeWeight: data already up to date');
    return;
  }

  const guildContract = GuildToken__factory.connect(GetGuildTokenAddress(), multicallProvider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    fullHistoricalData.values[blockToFetch] = {};
    const liveTerms = await guildContract.liveGauges({ blockTag: blockToFetch });
    const blockData = await retry(GetBlock, [web3Provider, blockToFetch]);

    const promises = [];

    for (const termAddress of liveTerms) {
      promises.push(guildContract.getGaugeWeight(termAddress));
    }

    const results = await Promise.all(promises);

    let cursor = 0;
    let totalWeight = 0;
    for (const termAddress of liveTerms) {
      const gaugeWeight = results[cursor++];
      fullHistoricalData.values[blockToFetch][`${termAddress}-weight`] = norm(gaugeWeight);
      totalWeight += norm(gaugeWeight);
    }

    fullHistoricalData.blockTimes[blockToFetch] = blockData.timestamp;

    console.log(
      `HistoricalDataFetcher | fetchGaugeWeight: [${blockToFetch}] (${new Date(
        blockData.timestamp * 1000
      ).toISOString()}) total weight: ${totalWeight}`
    );
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

async function fetchSurplusBuffer(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider
) {
  const multicallProvider = MulticallWrapper.wrap(web3Provider);

  let startBlock = GetDeployBlock();
  const historyFilename = path.join(historicalDataDir, 'surplus-buffer.json');
  let fullHistoricalData: HistoricalDataMulti = {
    name: 'surplus-buffer',
    values: {},
    blockTimes: {}
  };

  if (fs.existsSync(historyFilename)) {
    fullHistoricalData = ReadJSON(historyFilename);
    startBlock = Number(Object.keys(fullHistoricalData.values).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    console.log('HistoricalDataFetcher | fetchSurplusBuffer: data already up to date');
    return;
  }

  const guildContract = GuildToken__factory.connect(GetGuildTokenAddress(), multicallProvider);
  const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), multicallProvider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    fullHistoricalData.values[blockToFetch] = {};
    const liveTerms = await guildContract.liveGauges({ blockTag: blockToFetch });
    const blockData = await retry(GetBlock, [web3Provider, blockToFetch]);

    const promises = [];

    for (const termAddress of liveTerms) {
      promises.push(profitManagerContract.termSurplusBuffer(termAddress));
    }

    const results = await Promise.all(promises);

    let cursor = 0;
    let totalBuffer = 0;
    for (const termAddress of liveTerms) {
      const surplusBuffer = results[cursor++];
      fullHistoricalData.values[blockToFetch][`${termAddress}-surplus-buffer`] = norm(surplusBuffer);
      totalBuffer += norm(surplusBuffer);
    }

    fullHistoricalData.blockTimes[blockToFetch] = blockData.timestamp;

    console.log(
      `HistoricalDataFetcher | fetchSurplusBuffer: [${blockToFetch}] (${new Date(
        blockData.timestamp * 1000
      ).toISOString()}) total surplus buffer: ${totalBuffer}`
    );
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

HistoricalDataFetcher();
