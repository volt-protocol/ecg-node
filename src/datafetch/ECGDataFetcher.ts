import { JsonRpcProvider, ethers } from 'ethers';
import { MulticallWrapper } from 'ethers-multicall-provider';
import fs from 'fs';
import path from 'path';
import { APP_ENV, DATA_DIR } from '../utils/Constants';
import { SyncData } from '../model/SyncData';
import {
  GuildToken__factory,
  LendingTerm as LendingTermType,
  LendingTerm__factory,
  ProfitManager__factory
} from '../contracts/types';
import LendingTerm, { LendingTermStatus } from '../model/LendingTerm';
import { norm } from '../utils/TokenUtils';
import { GetDeployBlock, GetGuildTokenAddress, GetProfitManagerAddress, getTokenByAddress } from '../config/Config';
import { roundTo } from '../utils/Utils';

export async function FetchECGData() {
  const rpcURL = process.env.RPC_URL;
  if (!rpcURL) {
    throw new Error('Cannot find RPC_URL in env');
  }

  const web3Provider = new ethers.JsonRpcProvider(rpcURL);

  const currentBlock = await web3Provider.getBlockNumber();
  console.log(`FetchECGData: fetching data up to block ${currentBlock}`);

  const startBlockToFetch: number = getLastBlockFetched() + 1;
  console.log(`FetchECGData: fetching data since block ${startBlockToFetch}`);
  console.log(`FetchECGData: ${currentBlock - startBlockToFetch} blocks to fetch`);
  const terms = await fetchAndSaveTerms(web3Provider);
  // const loans = await fetchAndSaveLoans(web3Provider, terms, startBlockToFetch);

  console.log('FetchECGData: finished fetching');
}

async function fetchAndSaveTerms(web3Provider: JsonRpcProvider) {
  const guildTokenContract = GuildToken__factory.connect(GetGuildTokenAddress(), web3Provider);
  const gauges = await guildTokenContract.gauges();
  const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), web3Provider);
  const multicallProvider = MulticallWrapper.wrap(web3Provider);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const promises: any[] = [];
  promises.push(profitManagerContract.minBorrow());
  promises.push(profitManagerContract.creditMultiplier());
  for (const lendingTermAddress of gauges) {
    console.log(`FetchECGData: adding call for on lending term ${lendingTermAddress}`);
    const lendingTermContract = LendingTerm__factory.connect(lendingTermAddress, multicallProvider);
    promises.push(lendingTermContract.getParameters());
    promises.push(lendingTermContract.issuance());
    promises.push(lendingTermContract['debtCeiling()']());
  }

  // wait the promises
  console.log(`FetchECGData: sending ${promises.length} multicall`);
  await Promise.all(promises);
  console.log('FetchECGData: end multicall');

  const lendingTerms: LendingTerm[] = [];
  let cursor = 0;
  const minBorrow: bigint = await promises[cursor++];
  const creditMultiplier: bigint = await promises[cursor++];
  for (const lendingTermAddress of gauges) {
    // read promises in the same order as the multicall
    const termParameters: LendingTermType.LendingTermParamsStructOutput = await promises[cursor++];
    const issuance: bigint = await promises[cursor++];
    const debtCeiling: bigint = await promises[cursor++];

    const realCap = termParameters.hardCap > debtCeiling ? debtCeiling : termParameters.hardCap;
    const availableDebt = issuance > realCap ? 0n : realCap - issuance;
    lendingTerms.push({
      termAddress: lendingTermAddress,
      collateralAddress: termParameters.collateralToken,
      interestRate: termParameters.interestRate.toString(10),
      borrowRatio: termParameters.maxDebtPerCollateralToken.toString(10),
      currentDebt: issuance.toString(10),
      hardCap: termParameters.hardCap.toString(),
      availableDebt: availableDebt.toString(),
      openingFee: termParameters.openingFee.toString(10),
      minPartialRepayPercent: termParameters.minPartialRepayPercent.toString(10),
      maxDelayBetweenPartialRepay: termParameters.maxDelayBetweenPartialRepay.toString(10),
      minBorrow: minBorrow.toString(10),
      status: LendingTermStatus.LIVE,
      label: '',
      collateralSymbol: '',
      collateralDecimals: 0,
      permitAllowed: false
    });
  }

  // update data like collateral token symbol and decimals
  // and recompute borrowRatio
  for (const lendingTerm of lendingTerms) {
    const collateralToken = getTokenByAddress(lendingTerm.collateralAddress);
    lendingTerm.collateralSymbol = collateralToken.symbol;
    lendingTerm.collateralDecimals = collateralToken.decimals;
    lendingTerm.permitAllowed = collateralToken.permitAllowed;

    lendingTerm.borrowRatio = (
      (BigInt(lendingTerm.borrowRatio) * 10n ** BigInt(lendingTerm.collateralDecimals)) /
      creditMultiplier
    ).toString(10);
    lendingTerm.label = `${lendingTerm.collateralSymbol}-${roundTo(norm(lendingTerm.interestRate) * 100, 2)}%-${roundTo(
      norm(lendingTerm.borrowRatio),
      2
    )}`;
  }

  // update status by calling deprecated gauges
  const deprecatedGauges = await guildTokenContract.deprecatedGauges();
  for (const lendingTerm of lendingTerms) {
    if (deprecatedGauges.includes(lendingTerm.termAddress)) {
      lendingTerm.status = LendingTermStatus.DEPRECATED;
    }
  }

  const lendingTermsPath = path.join(DATA_DIR, 'terms.json');
  const fetchData = Date.now();
  fs.writeFileSync(
    lendingTermsPath,
    JSON.stringify(
      { updated: fetchData, updatedHuman: new Date(fetchData).toISOString(), terms: lendingTerms },
      null,
      2
    )
  );

  return lendingTerms;
}

function getLastBlockFetched() {
  const syncDataPath = path.join(DATA_DIR, 'sync.json');
  if (!fs.existsSync(syncDataPath)) {
    console.log(APP_ENV);
    // create the sync file
    const syncData: SyncData = {
      lastBlockFetched: GetDeployBlock() - 1
    };
    fs.writeFileSync(syncDataPath, JSON.stringify(syncData, null, 2));

    return syncData.lastBlockFetched;
  } else {
    const syncData: SyncData = JSON.parse(fs.readFileSync(syncDataPath, 'utf-8'));
    return syncData.lastBlockFetched;
  }
}
async function fetchAndSaveLoans(web3Provider: JsonRpcProvider, terms: LendingTerm[], startBlockToFetch: number) {
  throw new Error('Function not implemented.');
}
