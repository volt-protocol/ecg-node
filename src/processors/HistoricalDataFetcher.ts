import { GetProtocolData, ReadJSON, WaitUntilScheduled, WriteJSON, retry } from '../utils/Utils';

import fs from 'fs';
import path from 'path';
import { BLOCK_PER_HOUR, DATA_DIR, MARKET_ID } from '../utils/Constants';
import { ethers } from 'ethers';
import {
  GetCreditTokenAddress,
  GetDeployBlock,
  GetGuildTokenAddress,
  GetPSMAddress,
  GetPegTokenAddress,
  GetProfitManagerAddress,
  LoadConfiguration,
  getTokenByAddress,
  getTokenByAddressNoError
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
import { FetchAllEventsMulti, GetBlock, GetERC20Infos, GetWeb3Provider } from '../utils/Web3Helper';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { GetTokenPriceAtTimestamp } from '../utils/Price';
import { Loan, LoanStatus } from '../model/Loan';
import { HistoricalDataStateLoanBorrow } from '../model/HistoricalDataState';
import { Log, Warn } from '../utils/Logger';
import { GetGaugeForMarketId } from '../utils/ECGHelper';
import LastActivityFetcher from '../datafetch/fetchers/LastActivityFetcher';
import { LendingTermsFileStructure } from '../model/LendingTerm';
import { SyncData } from '../model/SyncData';
dotenv.config();

const runEverySec = 30 * 60; // every 30 minutes
const STEP_BLOCK = BLOCK_PER_HOUR;
/**
 * Fetches data historically since the protocol deployment, 1 data per hour for a selected data
 * Assumes 1 block = 13 seconds so fetches data for every 277 blocks
 */
async function HistoricalDataFetcher() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // load external config
    await LoadConfiguration();
    process.title = 'ECG_NODE_HISTORICAL_DATA_FETCHER';
    const startDate = Date.now();
    Log('starting');
    const rpcURL = process.env.RPC_URL;
    if (!rpcURL) {
      throw new Error('Cannot find RPC_URL in env');
    }

    await FetchHistoricalData();
    await WaitUntilScheduled(startDate, runEverySec);
  }
}

async function FetchHistoricalData() {
  const web3Provider = GetWeb3Provider();

  const currentBlock = await web3Provider.getBlockNumber();
  Log(`fetching data up to block ${currentBlock}`);

  const historicalDataDir = path.join(DATA_DIR, 'history');

  if (!fs.existsSync(historicalDataDir)) {
    fs.mkdirSync(historicalDataDir, { recursive: true });
  }

  const blockTimes: { [blockNumber: number]: number } = await fetchBlocks(
    currentBlock,
    historicalDataDir,
    web3Provider
  );
  await Promise.all([
    fetchCreditTotalSupply(currentBlock, historicalDataDir, web3Provider, blockTimes),
    fetchCreditTotalIssuance(currentBlock, historicalDataDir, web3Provider, blockTimes),
    fetchAverageInterestRate(currentBlock, historicalDataDir, web3Provider, blockTimes),
    fetchTVL(currentBlock, historicalDataDir, web3Provider, blockTimes),
    fetchDebtCeilingAndIssuance(currentBlock, historicalDataDir, web3Provider, blockTimes),
    fetchGaugeWeight(currentBlock, historicalDataDir, web3Provider, blockTimes),
    fetchSurplusBuffer(currentBlock, historicalDataDir, web3Provider, blockTimes),
    fetchLoansData(currentBlock, historicalDataDir, web3Provider, blockTimes),
    fetchCreditMultiplier(currentBlock, historicalDataDir, web3Provider, blockTimes),
    fetchAPRData(currentBlock, historicalDataDir, web3Provider, blockTimes)
  ]);
  // await fetchCreditTotalSupply(currentBlock, historicalDataDir, web3Provider, blockTimes);
  // await fetchCreditTotalIssuance(currentBlock, historicalDataDir, web3Provider, blockTimes);
  // await fetchAverageInterestRate(currentBlock, historicalDataDir, web3Provider, blockTimes);
  // await fetchTVL(currentBlock, historicalDataDir, web3Provider, blockTimes);
  // await fetchDebtCeilingAndIssuance(currentBlock, historicalDataDir, web3Provider, blockTimes);
  // await fetchGaugeWeight(currentBlock, historicalDataDir, web3Provider, blockTimes);
  // await fetchSurplusBuffer(currentBlock, historicalDataDir, web3Provider, blockTimes);
  // await fetchLoansData(currentBlock, historicalDataDir, web3Provider, state, blockTimes);
  // await fetchCreditMultiplier(currentBlock, historicalDataDir, web3Provider, blockTimes);
  // await fetchAPRData(currentBlock, historicalDataDir, web3Provider, blockTimes);
}

async function fetchBlocks(currentBlock: number, historicalDataDir: string, web3Provider: ethers.JsonRpcProvider) {
  let startBlock = GetDeployBlock();
  const historyFilename = path.join(historicalDataDir, 'blocks.json');
  let fullHistoricalData: HistoricalData = {
    name: 'blocks',
    values: {},
    blockTimes: {}
  };

  if (fs.existsSync(historyFilename)) {
    fullHistoricalData = ReadJSON(historyFilename);
    startBlock = Number(Object.keys(fullHistoricalData.blockTimes).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    Log('fetchBlocks: data already up to date');
    return fullHistoricalData.blockTimes;
  }

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    const blockData = await retry(GetBlock, [web3Provider, blockToFetch]);
    fullHistoricalData.blockTimes[blockToFetch] = blockData.timestamp;

    Log(`fetchBlocks: [${blockToFetch}] (${new Date(blockData.timestamp * 1000).toISOString()}) block saved`);
    WriteJSON(historyFilename, fullHistoricalData);
  }
  WriteJSON(historyFilename, fullHistoricalData);

  return fullHistoricalData.blockTimes;
}

async function fetchCreditTotalSupply(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider,
  blockTimes: { [blocknumber: number]: number }
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
    Log('fetchCreditTotalSupply: data already up to date');
    return;
  }

  const creditTokenContract = CreditToken__factory.connect(GetCreditTokenAddress(), web3Provider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    const totalSupplyAtBlock = await creditTokenContract.totalSupply({ blockTag: blockToFetch });
    fullHistoricalData.values[blockToFetch] = norm(totalSupplyAtBlock);
    fullHistoricalData.blockTimes[blockToFetch] = blockTimes[blockToFetch];
    Log(
      `fetchCreditTotalSupply: [${blockToFetch}] (${new Date(
        blockTimes[blockToFetch] * 1000
      ).toISOString()}) total supply : ${fullHistoricalData.values[blockToFetch]}`
    );
    WriteJSON(historyFilename, fullHistoricalData);
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

async function fetchCreditTotalIssuance(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider,
  blockTimes: { [blocknumber: number]: number }
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
    Log('fetchCreditTotalIssuance: data already up to date');
    return;
  }

  const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), web3Provider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    const totalIssuanceAtBlock = await profitManagerContract.totalIssuance({ blockTag: blockToFetch });
    fullHistoricalData.values[blockToFetch] = norm(totalIssuanceAtBlock);
    fullHistoricalData.blockTimes[blockToFetch] = blockTimes[blockToFetch];
    Log(
      `fetchCreditTotalIssuance: [${blockToFetch}] (${new Date(
        blockTimes[blockToFetch] * 1000
      ).toISOString()}) total issuance : ${fullHistoricalData.values[blockToFetch]}`
    );
    WriteJSON(historyFilename, fullHistoricalData);
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

async function fetchCreditMultiplier(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider,
  blockTimes: { [blocknumber: number]: number }
) {
  let startBlock = GetDeployBlock();
  const historyFilename = path.join(historicalDataDir, 'credit-multiplier.json');
  let fullHistoricalData: HistoricalData = {
    name: 'credit-multiplier',
    values: {},
    blockTimes: {}
  };

  if (fs.existsSync(historyFilename)) {
    fullHistoricalData = ReadJSON(historyFilename);
    startBlock = Number(Object.keys(fullHistoricalData.values).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    Log('fetchCreditMultiplier: data already up to date');
    return;
  }

  const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), web3Provider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    const creditMultiplier = await retry(() => profitManagerContract.creditMultiplier({ blockTag: blockToFetch }), []);
    fullHistoricalData.values[blockToFetch] = norm(creditMultiplier);
    fullHistoricalData.blockTimes[blockToFetch] = blockTimes[blockToFetch];
    Log(
      `fetchCreditMultiplier: [${blockToFetch}] (${new Date(
        blockTimes[blockToFetch] * 1000
      ).toISOString()}) credit multiplier: ${fullHistoricalData.values[blockToFetch]}`
    );
    WriteJSON(historyFilename, fullHistoricalData);
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

async function fetchAverageInterestRate(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider,
  blockTimes: { [blocknumber: number]: number }
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
    Log('fetchAverageInterestRate: data already up to date');
    return;
  }

  const guildContract = GuildToken__factory.connect(GetGuildTokenAddress(), multicallProvider);
  const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), multicallProvider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    const liveTerms = await GetGaugeForMarketId(guildContract, MARKET_ID, true, blockToFetch);
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
    fullHistoricalData.blockTimes[blockToFetch] = blockTimes[blockToFetch];

    Log(
      `fetchAverageInterestRate: [${blockToFetch}] (${new Date(
        blockTimes[blockToFetch] * 1000
      ).toISOString()}) avg interest rate : ${fullHistoricalData.values[blockToFetch]}`
    );
    WriteJSON(historyFilename, fullHistoricalData);
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

async function fetchTVL(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider,
  blockTimes: { [blocknumber: number]: number }
) {
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
    Log('fetchTVL: data already up to date');
    return;
  }

  const guildContract = GuildToken__factory.connect(GetGuildTokenAddress(), multicallProvider);
  const pegTokenContract = ERC20__factory.connect(GetPegTokenAddress(), web3Provider);
  const pegToken = getTokenByAddress(GetPegTokenAddress());

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    const liveTerms = await GetGaugeForMarketId(guildContract, MARKET_ID, true, blockToFetch);

    const collateralPromises = [];
    const pegTokenBalance = await pegTokenContract.balanceOf(GetPSMAddress(), { blockTag: blockToFetch });
    const pegTokenPrice = await GetTokenPriceAtTimestamp(
      pegToken.mainnetAddress || pegToken.address,
      blockTimes[blockToFetch]
    );

    const psmPegTokenValue = (pegTokenPrice ?? 0) * norm(pegTokenBalance, pegToken.decimals);

    for (const termAddress of liveTerms) {
      const termContract = LendingTerm__factory.connect(termAddress, multicallProvider);
      collateralPromises.push(termContract.collateralToken({ blockTag: blockToFetch }));
    }

    const collateralResults = await Promise.all(collateralPromises);

    let cursor = 0;
    const balanceOfPromises = [];
    for (const termAddress of liveTerms) {
      const termCollateral = collateralResults[cursor++] as string;
      const erc20Contract = ERC20__factory.connect(termCollateral, multicallProvider);
      balanceOfPromises.push(erc20Contract.balanceOf(termAddress, { blockTag: blockToFetch }));
    }

    const balanceOfResults = await Promise.all(balanceOfPromises);

    // here we have all the collaterals and the balances of each terms
    // we need to fetch the collateral price (historical) of each tokens
    cursor = 0;
    let tvlInUsd = 0;
    for (const collateralAddress of collateralResults) {
      let tokenConf = getTokenByAddressNoError(collateralAddress);
      if (!tokenConf) {
        tokenConf = await GetERC20Infos(web3Provider, collateralAddress);
        Warn(
          `Token ${collateralAddress} not found in config. ERC20 infos: ${tokenConf.symbol} / ${tokenConf.decimals} decimals`
        );
      }

      const balanceNorm = norm(balanceOfResults[cursor++], tokenConf.decimals);
      const priceAtTimestamp = await GetTokenPriceAtTimestamp(
        tokenConf.mainnetAddress || tokenConf.address,
        blockTimes[blockToFetch]
      );
      const termTvl = (priceAtTimestamp ?? 0) * balanceNorm;
      tvlInUsd += termTvl;
    }

    fullHistoricalData.values[blockToFetch] = tvlInUsd + psmPegTokenValue;
    fullHistoricalData.blockTimes[blockToFetch] = blockTimes[blockToFetch];

    Log(
      `fetchTVL: [${blockToFetch}] (${new Date(blockTimes[blockToFetch] * 1000).toISOString()}) TVL : ${
        fullHistoricalData.values[blockToFetch]
      }. TCL: $${tvlInUsd}, PSM pegTokenValue: $${psmPegTokenValue}`
    );

    WriteJSON(historyFilename, fullHistoricalData);
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

async function fetchDebtCeilingAndIssuance(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider,
  blockTimes: { [blocknumber: number]: number }
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
    Log('fetchDebtCeilingAndIssuance: data already up to date');
    return;
  }

  const guildContract = GuildToken__factory.connect(GetGuildTokenAddress(), multicallProvider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    fullHistoricalData.values[blockToFetch] = {};
    const liveTerms = await GetGaugeForMarketId(guildContract, MARKET_ID, true, blockToFetch);

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

    fullHistoricalData.blockTimes[blockToFetch] = blockTimes[blockToFetch];

    Log(
      `fetchDebtCeilingAndIssuance: [${blockToFetch}] (${new Date(
        blockTimes[blockToFetch] * 1000
      ).toISOString()}) total debtCeiling: ${totalDebtCeiling} | total issuance: ${totalIssuance}`
    );
    WriteJSON(historyFilename, fullHistoricalData);
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

async function fetchGaugeWeight(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider,
  blockTimes: { [blocknumber: number]: number }
) {
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
    Log('fetchGaugeWeight: data already up to date');
    return;
  }

  const guildContract = GuildToken__factory.connect(GetGuildTokenAddress(), multicallProvider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    fullHistoricalData.values[blockToFetch] = {};
    const liveTerms = await GetGaugeForMarketId(guildContract, MARKET_ID, true, blockToFetch);

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

    fullHistoricalData.blockTimes[blockToFetch] = blockTimes[blockToFetch];

    Log(
      `fetchGaugeWeight: [${blockToFetch}] (${new Date(
        blockTimes[blockToFetch] * 1000
      ).toISOString()}) total weight: ${totalWeight}`
    );
    WriteJSON(historyFilename, fullHistoricalData);
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

async function fetchSurplusBuffer(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider,
  blockTimes: { [blocknumber: number]: number }
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
    Log('fetchSurplusBuffer: data already up to date');
    return;
  }

  const guildContract = GuildToken__factory.connect(GetGuildTokenAddress(), multicallProvider);
  const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), multicallProvider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    fullHistoricalData.values[blockToFetch] = {};
    const liveTerms = await GetGaugeForMarketId(guildContract, MARKET_ID, true, blockToFetch);

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

    fullHistoricalData.blockTimes[blockToFetch] = blockTimes[blockToFetch];

    Log(
      `fetchSurplusBuffer: [${blockToFetch}] (${new Date(
        blockTimes[blockToFetch] * 1000
      ).toISOString()}) total surplus buffer: ${totalBuffer}`
    );
    WriteJSON(historyFilename, fullHistoricalData);
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

async function fetchLoansData(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider,
  blockTimes: { [blocknumber: number]: number }
) {
  let historicalDataState: HistoricalDataStateLoanBorrow = {
    openLoans: {}
  };

  const historicalDataStateFile = path.join(DATA_DIR, 'processors', 'historical-data-state-loan-borrow.json');
  if (fs.existsSync(historicalDataStateFile)) {
    historicalDataState = ReadJSON(historicalDataStateFile);
  }

  const multicallProvider = MulticallWrapper.wrap(web3Provider);

  let startBlock = GetDeployBlock();
  const historyFilename = path.join(historicalDataDir, 'loan-borrow.json');

  let fullHistoricalData: HistoricalDataMulti = {
    name: 'loan-borrow',
    values: {},
    blockTimes: {}
  };

  if (fs.existsSync(historyFilename)) {
    fullHistoricalData = ReadJSON(historyFilename);
    startBlock = Number(Object.keys(fullHistoricalData.values).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    Log('fetchLoansData: data already up to date');
    return;
  }

  const guildContract = GuildToken__factory.connect(GetGuildTokenAddress(), multicallProvider);
  const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), multicallProvider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    fullHistoricalData.values[blockToFetch] = {};
    fullHistoricalData.blockTimes[blockToFetch] = blockTimes[blockToFetch];
    const liveTerms = await GetGaugeForMarketId(guildContract, MARKET_ID, true, blockToFetch);
    const creditMultiplier = await profitManagerContract.creditMultiplier({ blockTag: blockToFetch });

    // for all live terms get the LoanOpen events from blockToFetch - STEP_BLOCK to blockToFetch
    const termContractInterface = LendingTerm__factory.createInterface();
    const topics = termContractInterface.encodeFilterTopics('LoanOpen', []);
    const logs = await FetchAllEventsMulti(
      LendingTerm__factory.createInterface(),
      liveTerms,
      topics,
      blockToFetch - STEP_BLOCK + 1,
      blockToFetch,
      web3Provider
    );

    for (const log of logs) {
      if (!historicalDataState.openLoans[log.address]) {
        historicalDataState.openLoans[log.address] = [];
      }

      historicalDataState.openLoans[log.address].push(log.args.loanId);
    }

    // for (const termAddress of liveTerms) {
    //   const termContract = LendingTerm__factory.connect(termAddress, web3Provider);

    //   const newLoanIds = await FetchAllEventsAndExtractStringArray(
    //     termContract,
    //     `Term-${termAddress}`,
    //     'LoanOpen',
    //     ['loanId'],
    //     blockToFetch - STEP_BLOCK + 1,
    //     blockToFetch
    //   );

    //   if (!historicalDataState.openLoans[termAddress]) {
    //     historicalDataState.openLoans[termAddress] = [];
    //   }

    //   historicalDataState.openLoans[termAddress].push(...newLoanIds);
    // }

    // for all open loans, fetch amount borrowed and check if still open
    const promises = [];
    for (const termAddress of Object.keys(historicalDataState.openLoans)) {
      const lendingTermContract = LendingTerm__factory.connect(termAddress, multicallProvider);
      for (const loanId of historicalDataState.openLoans[termAddress]) {
        promises.push(lendingTermContract.getLoan(loanId, { blockTag: blockToFetch }));
        promises.push(lendingTermContract.getLoanDebt(loanId, { blockTag: blockToFetch }));
      }
    }

    const getLoanResults = await Promise.all(promises);

    let cursor = 0;
    const allLoans: Loan[] = [];
    for (const termAddress of Object.keys(historicalDataState.openLoans)) {
      for (const loanId of historicalDataState.openLoans[termAddress]) {
        const loanData = getLoanResults[cursor++] as LendingTerm.LoanStructOutput;
        const loanDebt = getLoanResults[cursor++] as bigint;
        allLoans.push({
          id: loanId,
          bidTime: Number(loanData.closeTime) * 1000,
          borrowerAddress: loanData.borrower,
          borrowAmount: loanData.borrowAmount.toString(10),
          callerAddress: loanData.caller,
          callTime: Number(loanData.callTime) * 1000,
          closeTime: Number(loanData.closeTime) * 1000,
          collateralAmount: loanData.collateralAmount.toString(10),
          debtWhenSeized: loanData.callDebt.toString(10),
          lendingTermAddress: termAddress,
          status: Number(loanData.closeTime) == 0 ? LoanStatus.ACTIVE : LoanStatus.CLOSED,
          originationTime: Number(loanData.borrowTime) * 1000,
          lastPartialRepay: Number(loanData.lastPartialRepay) * 1000,
          borrowCreditMultiplier: '0',
          txHashClose: '',
          txHashOpen: '',
          loanDebt: loanDebt.toString(10),
          debtRepaid: '0'
        });
      }
    }

    let currentlyOpenedLoans = 0;
    let totalBorrowPegToken = 0;
    let totalUnpaidInterests = 0;
    // cleanup openLoans to only save the currently still open loans
    historicalDataState.openLoans = {};
    for (const loan of allLoans) {
      if (loan.status != LoanStatus.CLOSED) {
        currentlyOpenedLoans++;
        totalBorrowPegToken += norm(loan.borrowAmount) * norm(creditMultiplier);
        totalUnpaidInterests += (norm(loan.loanDebt) - norm(loan.borrowAmount)) * norm(creditMultiplier);

        if (!historicalDataState.openLoans[loan.lendingTermAddress]) {
          historicalDataState.openLoans[loan.lendingTermAddress] = [];
        }

        historicalDataState.openLoans[loan.lendingTermAddress].push(loan.id);
      }
    }

    fullHistoricalData.values[blockToFetch].openLoans = currentlyOpenedLoans;
    fullHistoricalData.values[blockToFetch].borrowValue = totalBorrowPegToken;
    fullHistoricalData.values[blockToFetch].totalUnpaidInterests = totalUnpaidInterests;

    Log(
      `fetchLoansData: [${blockToFetch}] (${new Date(
        blockTimes[blockToFetch] * 1000
      ).toISOString()}) openLoans: ${currentlyOpenedLoans}, borrowValue: ${totalBorrowPegToken}, unpaid interests: ${totalUnpaidInterests}`
    );
    WriteJSON(historyFilename, fullHistoricalData);
    // save state file
    WriteJSON(historicalDataStateFile, historicalDataState);
  }

  WriteJSON(historyFilename, fullHistoricalData);
  // save state file
  WriteJSON(historicalDataStateFile, historicalDataState);
}

async function fetchAPRData(
  currentBlock: number,
  historicalDataDir: string,
  web3Provider: ethers.JsonRpcProvider,
  blockTimes: { [blocknumber: number]: number }
) {
  const multicallProvider = MulticallWrapper.wrap(web3Provider);

  let startBlock = GetDeployBlock();
  const historyFilename = path.join(historicalDataDir, 'apr-data.json');
  let fullHistoricalData: HistoricalDataMulti = {
    name: 'apr-data',
    values: {},
    blockTimes: {}
  };

  if (fs.existsSync(historyFilename)) {
    fullHistoricalData = ReadJSON(historyFilename);
    startBlock = Number(Object.keys(fullHistoricalData.values).at(-1)) + STEP_BLOCK;
  }

  if (startBlock > currentBlock) {
    Log('fetchDebtCeilingAndIssuance: data already up to date');
    return;
  }

  const creditContract = CreditToken__factory.connect(GetCreditTokenAddress(), multicallProvider);

  for (let blockToFetch = startBlock; blockToFetch <= currentBlock; blockToFetch += STEP_BLOCK) {
    fullHistoricalData.values[blockToFetch] = {};
    const creditData = await Promise.all([
      creditContract.rebasingSupply(),
      creditContract.totalSupply(),
      creditContract.targetTotalSupply()
    ]);

    const sharePrice = await getSharePrice(blockTimes[blockToFetch], web3Provider, blockToFetch);
    fullHistoricalData.values[blockToFetch].rebasingSupply = norm(creditData[0]);
    fullHistoricalData.values[blockToFetch].totalSupply = norm(creditData[1]);
    fullHistoricalData.values[blockToFetch].targetTotalSupply = norm(creditData[2]);
    fullHistoricalData.values[blockToFetch].sharePrice = sharePrice;
    fullHistoricalData.blockTimes[blockToFetch] = blockTimes[blockToFetch];

    Log(
      `fetchAPRData: [${blockToFetch}] (${new Date(blockTimes[blockToFetch] * 1000).toISOString()}) | ` +
        `rebasingSupply ${fullHistoricalData.values[blockToFetch].rebasingSupply}` +
        `, totalSupply ${fullHistoricalData.values[blockToFetch].totalSupply}` +
        `, targetTotalSupply ${fullHistoricalData.values[blockToFetch].targetTotalSupply}` +
        `, sharePrice ${fullHistoricalData.values[blockToFetch].sharePrice}`
    );
    WriteJSON(historyFilename, fullHistoricalData);
  }

  WriteJSON(historyFilename, fullHistoricalData);
}

async function getSharePrice(
  timestampSec: number,
  web3Provider: ethers.JsonRpcProvider,
  blockNumber: number
): Promise<number> {
  // get value of internal data "__rebasingSharePrice" which is stored at index 20 and 21 of the CreditToken contract
  // value is a struct (uint32 lastTimestamp, uint224 lastValue, uint32 targetTimestamp, uint224 targetValue)
  // it appears the solidity dev forgot to put a public getter on this particular data so that's the only way to do it
  const val20 = await web3Provider.getStorage(GetCreditTokenAddress(), 20, blockNumber);
  const val21 = await web3Provider.getStorage(GetCreditTokenAddress(), 21, blockNumber);

  const lastTimestamp = Number(BigInt('0x' + val20.substring(val20.length - 8)));
  const lastValue = norm(BigInt(val20.substring(0, val20.length - 8)), 30);
  const targetTimestamp = Number(BigInt('0x' + val21.substring(val20.length - 8)));
  const targetValue = norm(BigInt(val21.substring(0, val20.length - 8)), 30);

  if (timestampSec >= targetTimestamp) {
    // if period is passed, return target value
    return targetValue;
  } else {
    // block.timestamp is within [lastTimestamp, targetTimestamp[
    const elapsed = timestampSec - lastTimestamp;
    const delta = targetValue - lastValue;
    return lastValue + (delta * elapsed) / (targetTimestamp - lastTimestamp);
  }
}

HistoricalDataFetcher();
