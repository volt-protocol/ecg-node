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

import { LendingTerm as LendingTermNamespace } from '../contracts/types/LendingTerm';
import LendingTerm, { LendingTermStatus, LendingTermsFileStructure } from '../model/LendingTerm';
import { norm } from '../utils/TokenUtils';
import { GetDeployBlock, GetGuildTokenAddress, GetProfitManagerAddress, getTokenByAddress } from '../config/Config';
import { roundTo } from '../utils/Utils';
import { Loan, LoanStatus, LoansFileStructure } from '../model/Loan';
import { FetchAllEventsAndExtractStringArray } from '../utils/Web3Helper';

export async function FetchECGData() {
  const rpcURL = process.env.RPC_URL;
  if (!rpcURL) {
    throw new Error('Cannot find RPC_URL in env');
  }

  const web3Provider = new ethers.JsonRpcProvider(rpcURL);

  const currentBlock = await web3Provider.getBlockNumber();
  console.log(`FetchECGData: fetching data up to block ${currentBlock}`);

  const syncData: SyncData = getSyncData();
  console.log('FetchECGData: fetching');
  const terms = await fetchAndSaveTerms(web3Provider);
  const loans = await fetchAndSaveLoans(web3Provider, terms, syncData, currentBlock);

  fs.writeFileSync(path.join(DATA_DIR, 'sync.json'), JSON.stringify(syncData, null, 2));
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
  const termFileData: LendingTermsFileStructure = {
    updated: fetchData,
    updatedHuman: new Date(fetchData).toISOString(),
    terms: lendingTerms
  };

  fs.writeFileSync(lendingTermsPath, JSON.stringify(termFileData, null, 2));

  return lendingTerms;
}

function getSyncData() {
  const syncDataPath = path.join(DATA_DIR, 'sync.json');
  if (!fs.existsSync(syncDataPath)) {
    console.log(APP_ENV);
    // create the sync file
    const syncData: SyncData = {
      termSync: []
    };
    fs.writeFileSync(syncDataPath, JSON.stringify(syncData, null, 2));

    return syncData;
  } else {
    const syncData: SyncData = JSON.parse(fs.readFileSync(syncDataPath, 'utf-8'));
    return syncData;
  }
}
async function fetchAndSaveLoans(
  web3Provider: JsonRpcProvider,
  terms: LendingTerm[],
  syncData: SyncData,
  currentBlock: number
) {
  let alreadySavedLoans: Loan[] = [];
  const loansFilePath = path.join(DATA_DIR, 'loans.json');
  if (fs.existsSync(loansFilePath)) {
    const loansFile: LoansFileStructure = JSON.parse(fs.readFileSync(loansFilePath, 'utf-8'));
    alreadySavedLoans = loansFile.loans;
  }

  const updateLoans: LoansFileStructure = {
    loans: [],
    updated: Date.now(),
    updatedHuman: new Date(Date.now()).toISOString()
  };

  const allNewLoandsIds: { termAddress: string; loanId: string }[] = [];
  for (const term of terms) {
    // check if we already have a sync data about this term
    const termSyncData = syncData.termSync.find((_) => _.termAddress == term.termAddress);
    let sinceBlock = GetDeployBlock();
    if (termSyncData) {
      sinceBlock = termSyncData.lastBlockFetched + 1;
    }

    const termContract = LendingTerm__factory.connect(term.termAddress, web3Provider);

    const newLoanIds = await FetchAllEventsAndExtractStringArray(
      termContract,
      term.label,
      'LoanOpen',
      ['loanId'],
      sinceBlock,
      currentBlock
    );

    allNewLoandsIds.push(
      ...newLoanIds.map((_) => {
        return { termAddress: term.termAddress, loanId: _ };
      })
    );
    // update term sync data
    if (!termSyncData) {
      syncData.termSync.push({
        lastBlockFetched: currentBlock,
        termAddress: term.termAddress
      });
    } else {
      termSyncData.lastBlockFetched = currentBlock;
    }
  }

  const allLoanIds = alreadySavedLoans.map((_) => {
    return { termAddress: _.lendingTermAddress, loanId: _.id };
  });

  for (const newLoanId of allNewLoandsIds) {
    if (!allLoanIds.some((_) => _.loanId == newLoanId.loanId && _.termAddress == newLoanId.termAddress)) {
      allLoanIds.push(newLoanId);
    }
  }

  // fetch data for all loans
  const allUpdatedLoans: Loan[] = await fetchLoansInfo(allLoanIds, web3Provider);
  updateLoans.loans = allUpdatedLoans;
  const endDate = Date.now();
  updateLoans.updated = endDate;
  updateLoans.updatedHuman = new Date(endDate).toISOString();
  fs.writeFileSync(loansFilePath, JSON.stringify(updateLoans, null, 2));
}

async function fetchLoansInfo(
  allLoanIds: { termAddress: string; loanId: string }[],
  web3Provider: JsonRpcProvider
): Promise<Loan[]> {
  const multicallProvider = MulticallWrapper.wrap(web3Provider);
  const promises: Promise<LendingTermNamespace.LoanStructOutput>[] = [];
  for (const loanData of allLoanIds) {
    const lendingTermContract = LendingTerm__factory.connect(loanData.termAddress, multicallProvider);
    promises.push(lendingTermContract.getLoan(loanData.loanId));
  }

  console.log(`sending loans() multicall for ${allLoanIds.length} loans`);
  await Promise.all(promises);
  console.log('end multicall');

  let cursor = 0;
  const allLoans: Loan[] = [];
  for (const loan of allLoanIds) {
    const loanData = await promises[cursor++];
    allLoans.push({
      id: loan.loanId,
      bidTime: Number(loanData.closeTime) * 1000,
      borrowerAddress: loanData.borrower,
      borrowAmount: loanData.borrowAmount.toString(10),
      callerAddress: loanData.caller,
      callTime: Number(loanData.callTime) * 1000,
      closeTime: Number(loanData.closeTime) * 1000,
      collateralAmount: loanData.collateralAmount.toString(10),
      debtWhenSeized: loanData.callDebt.toString(10),
      lendingTermAddress: loan.termAddress,
      status: Number(loanData.closeTime) == 0 ? LoanStatus.ACTIVE : LoanStatus.CLOSED,
      originationTime: Number(loanData.borrowTime) * 1000
    });
  }

  return allLoans;
}
