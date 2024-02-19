import { JsonRpcProvider, ethers } from 'ethers';
import { MulticallWrapper } from 'ethers-multicall-provider';
import fs from 'fs';
import path from 'path';
import { APP_ENV, DATA_DIR } from '../utils/Constants';
import { SyncData } from '../model/SyncData';
import {
  AuctionHouse,
  AuctionHouse__factory,
  GuildToken__factory,
  LendingTerm as LendingTermType,
  LendingTerm__factory,
  ProfitManager__factory
} from '../contracts/types';

import { LendingTerm as LendingTermNamespace } from '../contracts/types/LendingTerm';
import LendingTerm, { LendingTermStatus, LendingTermsFileStructure } from '../model/LendingTerm';
import { norm } from '../utils/TokenUtils';
import { GetDeployBlock, GetGuildTokenAddress, GetProfitManagerAddress, getTokenByAddress } from '../config/Config';
import { JsonBigIntReplacer, JsonBigIntReviver, ReadJSON, WriteJSON, roundTo } from '../utils/Utils';
import { Loan, LoanStatus, LoansFileStructure } from '../model/Loan';
import { GaugesFileStructure } from '../model/Gauge';
import { FetchAllEvents, FetchAllEventsAndExtractStringArray } from '../utils/Web3Helper';
import { Auction, AuctionStatus, AuctionsFileStructure } from '../model/Auction';

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
  const gauges = await fetchAndSaveGauges(web3Provider, syncData, currentBlock);
  const loans = await fetchAndSaveLoans(web3Provider, terms, syncData, currentBlock);
  const auctions = await fetchAndSaveAuctions(web3Provider, terms, syncData, currentBlock);

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
    promises.push(lendingTermContract.auctionHouse());
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
    const auctionHouseAddress: string = await promises[cursor++];

    const realCap = termParameters.hardCap > debtCeiling ? debtCeiling : termParameters.hardCap;
    const availableDebt = issuance > realCap ? 0n : realCap - issuance;
    lendingTerms.push({
      termAddress: lendingTermAddress,
      collateralAddress: termParameters.collateralToken,
      interestRate: termParameters.interestRate.toString(10),
      borrowRatio: termParameters.maxDebtPerCollateralToken.toString(10),
      maxDebtPerCollateralToken: termParameters.maxDebtPerCollateralToken.toString(10),
      currentDebt: issuance.toString(10),
      hardCap: termParameters.hardCap.toString(10),
      availableDebt: availableDebt.toString(10),
      openingFee: termParameters.openingFee.toString(10),
      minPartialRepayPercent: termParameters.minPartialRepayPercent.toString(10),
      maxDelayBetweenPartialRepay: Number(termParameters.maxDelayBetweenPartialRepay.toString(10)),
      minBorrow: minBorrow.toString(10),
      status: LendingTermStatus.LIVE,
      label: '',
      collateralSymbol: '',
      collateralDecimals: 0,
      permitAllowed: false,
      auctionHouseAddress: auctionHouseAddress
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
      termSync: [],
      gaugeSync: {
        lastBlockFetched: GetDeployBlock()
      },
      auctionSync: []
    };
    fs.writeFileSync(syncDataPath, JSON.stringify(syncData, null, 2));

    return syncData;
  } else {
    const syncData: SyncData = JSON.parse(fs.readFileSync(syncDataPath, 'utf-8'));
    return syncData;
  }
}
async function fetchAndSaveGauges(web3Provider: JsonRpcProvider, syncData: SyncData, currentBlock: number) {
  let sinceBlock = GetDeployBlock();
  if (syncData.gaugeSync) {
    sinceBlock = syncData.gaugeSync.lastBlockFetched + 1;
  } else {
    // if no gaugeSync, delete gauges.json if any
    if (fs.existsSync(path.join(DATA_DIR, 'gauges.json'))) {
      fs.rmSync(path.join(DATA_DIR, 'gauges.json'));
    }
  }

  // load existing gauges from file if it exists
  let gaugesFile: GaugesFileStructure = {
    gauges: {},
    updated: Date.now(),
    updatedHuman: new Date(Date.now()).toISOString()
  };
  const gaugesFilePath = path.join(DATA_DIR, 'gauges.json');
  if (fs.existsSync(gaugesFilePath)) {
    gaugesFile = ReadJSON(gaugesFilePath);
  }

  // fetch & handle data
  const guild = GuildToken__factory.connect(GetGuildTokenAddress(), web3Provider);

  // IncrementGaugeWeight(user, gauge, weight)
  (await FetchAllEvents(guild, 'GuildToken', 'IncrementGaugeWeight', sinceBlock, currentBlock)).forEach((event) => {
    gaugesFile.gauges[event.args.gauge] = gaugesFile.gauges[event.args.gauge] || {
      address: event.args.gauge,
      weight: 0n,
      lastLoss: 0,
      users: {}
    };
    gaugesFile.gauges[event.args.gauge].weight += event.args.weight;

    if (!gaugesFile.gauges[event.args.gauge].users[event.args.user]) {
      gaugesFile.gauges[event.args.gauge].users[event.args.user] = {
        address: event.args.user,
        weight: 0n,
        lastLossApplied: 0
      };
    }

    gaugesFile.gauges[event.args.gauge].users[event.args.user].weight += event.args.weight;

    // note: this is not exactly correct, we should be fetching the event's timestamp,
    // but this would require additional RPC calls, and we know we'll only be checking
    // the user lastLossApplied against the gauge's lastLoss. GuildToken.incrementWeight
    // would revert if there is an unapplied loss, so we know the user's lastLossApplied
    // is at least the gauge's lastLoss when an IncrementGaugeWeight event is emitted.
    gaugesFile.gauges[event.args.gauge].users[event.args.user].lastLossApplied =
      gaugesFile.gauges[event.args.gauge].lastLoss;
  });
  // DecrementGaugeWeight(user, gauge, weight)
  (await FetchAllEvents(guild, 'GuildToken', 'DecrementGaugeWeight', sinceBlock, currentBlock)).forEach((event) => {
    gaugesFile.gauges[event.args.gauge].weight -= event.args.weight;

    gaugesFile.gauges[event.args.gauge].users[event.args.user].weight -= event.args.weight;
  });

  // GaugeLoss(gauge, when)
  (await FetchAllEvents(guild, 'GuildToken', 'GaugeLoss', sinceBlock, currentBlock)).forEach((event) => {
    gaugesFile.gauges[event.args.gauge].lastLoss = Number(event.args.when);
  });
  // GaugeLossApply(gauge, who, weight, when)
  (await FetchAllEvents(guild, 'GuildToken', 'GaugeLossApply', sinceBlock, currentBlock)).forEach((event) => {
    gaugesFile.gauges[event.args.gauge].users[event.args.user].lastLossApplied = Number(event.args.when);
  });

  gaugesFile.updated = Date.now();
  gaugesFile.updatedHuman = new Date().toISOString();
  WriteJSON(gaugesFilePath, gaugesFile);

  // save sync data
  syncData.gaugeSync = syncData.gaugeSync || {
    lastBlockFetched: 0
  };
  syncData.gaugeSync.lastBlockFetched = currentBlock;
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
      originationTime: Number(loanData.borrowTime) * 1000,
      lastPartialRepay: Number(loanData.lastPartialRepay) * 1000
    });
  }

  for (const loan of allLoans.filter((_) => _.status == LoanStatus.ACTIVE)) {
    if (loan.callTime > 0) {
      loan.status = LoanStatus.CALLED;
    }
  }

  return allLoans;
}

async function fetchAndSaveAuctions(
  web3Provider: JsonRpcProvider,
  terms: LendingTerm[],
  syncData: SyncData,
  currentBlock: number
) {
  let alreadySavedAuctions: Auction[] = [];
  const auctionsFilePath = path.join(DATA_DIR, 'auctions.json');
  if (fs.existsSync(auctionsFilePath)) {
    const auctionsFile: AuctionsFileStructure = JSON.parse(fs.readFileSync(auctionsFilePath, 'utf-8'));
    alreadySavedAuctions = auctionsFile.auctions;
  }

  const updateAuctions: AuctionsFileStructure = {
    auctions: [],
    updated: Date.now(),
    updatedHuman: new Date(Date.now()).toISOString()
  };

  const allNewLoandsIds: { auctionHouseAddress: string; loanId: string }[] = [];
  const auctionsHouseAddresses = new Set<string>(terms.map((_) => _.auctionHouseAddress));
  for (const auctionHouseAddress of auctionsHouseAddresses) {
    // check if we already have a sync data about this term
    const auctionSyncData = syncData.auctionSync?.find((_) => _.auctionHouseAddress == auctionHouseAddress);
    let sinceBlock = GetDeployBlock();
    if (auctionSyncData) {
      sinceBlock = auctionSyncData.lastBlockFetched + 1;
    }

    const auctionHouseContract = AuctionHouse__factory.connect(auctionHouseAddress, web3Provider);

    const newLoanIds = await FetchAllEventsAndExtractStringArray(
      auctionHouseContract,
      auctionHouseAddress,
      'AuctionStart',
      ['loanId'],
      sinceBlock,
      currentBlock
    );

    allNewLoandsIds.push(
      ...newLoanIds.map((_) => {
        return { auctionHouseAddress: auctionHouseAddress, loanId: _ };
      })
    );

    // update term sync data
    if (!auctionSyncData) {
      if (!syncData.auctionSync) {
        syncData.auctionSync = [];
      }

      syncData.auctionSync.push({
        lastBlockFetched: currentBlock,
        auctionHouseAddress: auctionHouseAddress
      });
    } else {
      auctionSyncData.lastBlockFetched = currentBlock;
    }
  }

  const allLoanIds = alreadySavedAuctions.map((_) => {
    return { auctionHouseAddress: _.auctionHouseAddress, loanId: _.loanId };
  });

  for (const newLoanId of allNewLoandsIds) {
    if (
      !allLoanIds.some((_) => _.loanId == newLoanId.loanId && _.auctionHouseAddress == newLoanId.auctionHouseAddress)
    ) {
      allLoanIds.push(newLoanId);
    }
  }

  // fetch data for all auctions
  const allUpdatedAuctions: Auction[] = await fetchAuctionsInfo(allLoanIds, web3Provider);
  updateAuctions.auctions = allUpdatedAuctions;
  const endDate = Date.now();
  updateAuctions.updated = endDate;
  updateAuctions.updatedHuman = new Date(endDate).toISOString();
  fs.writeFileSync(auctionsFilePath, JSON.stringify(updateAuctions, null, 2));
}

async function fetchAuctionsInfo(
  allLoanIds: { auctionHouseAddress: string; loanId: string }[],
  web3Provider: JsonRpcProvider
): Promise<Auction[]> {
  const multicallProvider = MulticallWrapper.wrap(web3Provider);
  const promises: Promise<AuctionHouse.AuctionStructOutput>[] = [];
  for (const auctionData of allLoanIds) {
    const auctionHouseContract = AuctionHouse__factory.connect(auctionData.auctionHouseAddress, multicallProvider);
    promises.push(auctionHouseContract.getAuction(auctionData.loanId));
  }

  console.log(`sending getAuction() multicall for ${allLoanIds.length} loans`);
  await Promise.all(promises);
  console.log('end multicall');

  let cursor = 0;
  const allAuctions: Auction[] = [];
  for (const loan of allLoanIds) {
    const auctionData = await promises[cursor++];
    allAuctions.push({
      loanId: loan.loanId,
      auctionHouseAddress: loan.auctionHouseAddress,
      startTime: Number(auctionData.startTime) * 1000,
      endTime: Number(auctionData.endTime) * 1000,
      callCreditMultiplier: auctionData.callCreditMultiplier.toString(10),
      callDebt: auctionData.callDebt.toString(10),
      collateralAmount: auctionData.collateralAmount.toString(10),
      lendingTermAddress: auctionData.lendingTerm,
      status: Number(auctionData.endTime) > 0 ? AuctionStatus.CLOSED : AuctionStatus.ACTIVE
    });
  }

  return allAuctions;
}
