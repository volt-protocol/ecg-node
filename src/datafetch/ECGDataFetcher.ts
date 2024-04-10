import { JsonRpcProvider, ethers } from 'ethers';
import { MulticallWrapper } from 'ethers-multicall-provider';
import fs, { link } from 'fs';
import path from 'path';
import { DATA_DIR, MARKET_ID } from '../utils/Constants';
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
import { ReadJSON, WriteJSON, roundTo } from '../utils/Utils';
import { Loan, LoanStatus, LoansFileStructure } from '../model/Loan';
import { GaugesFileStructure } from '../model/Gauge';
import { FetchAllEvents, FetchAllEventsAndExtractStringArray, GetWeb3Provider } from '../utils/Web3Helper';
import { Auction, AuctionStatus, AuctionsFileStructure } from '../model/Auction';
import { ProtocolData, ProtocolDataFileStructure } from '../model/ProtocolData';
import { FileMutex } from '../utils/FileMutex';
import { Log } from '../utils/Logger';
import { GetGaugeForMarketId } from '../utils/ECGHelper';
import { SendNotifications } from '../utils/Notifications';
import { AuctionHouseData, AuctionHousesFileStructure } from '../model/AuctionHouse';

// amount of seconds between two fetches if no events on the protocol
const SECONDS_BETWEEN_FETCHES = 30 * 60;
let lastFetch = 0;

export async function FetchECGData() {
  await FileMutex.Lock();
  lastFetch = Date.now();
  try {
    const web3Provider = GetWeb3Provider();
    const currentBlock = await web3Provider.getBlockNumber();
    Log(`FetchECGData: fetching data up to block ${currentBlock}`);

    const syncData: SyncData = getSyncData();
    Log('FetchECGData: fetching');
    const protocolData = await fetchAndSaveProtocolData(web3Provider);
    const terms = await fetchAndSaveTerms(web3Provider, protocolData);
    const gauges = await fetchAndSaveGauges(web3Provider, syncData, currentBlock);
    const loans = await fetchAndSaveLoans(web3Provider, terms, syncData, currentBlock);
    const auctions = await fetchAndSaveAuctions(web3Provider, terms, syncData, currentBlock);
    const auctionsHouses = await fetchAndSaveAuctionHouses(web3Provider, terms);

    WriteJSON(path.join(DATA_DIR, 'sync.json'), syncData);
    Log('FetchECGData: finished fetching');
  } catch (e) {
    Log('FetchECGData: unknown failure', e);
    lastFetch = 0;
    await SendNotifications('Data Fetcher', 'Unknown exception when fetching data', JSON.stringify(e));
  } finally {
    await FileMutex.Unlock();
  }
}

async function fetchAndSaveAuctionHouses(web3Provider: JsonRpcProvider, terms: LendingTerm[]) {
  let allAuctionHouses: AuctionHouseData[] = [];
  const auctionHousesFilePath = path.join(DATA_DIR, 'auction-houses.json');
  if (fs.existsSync(auctionHousesFilePath)) {
    const auctionsFile: AuctionHousesFileStructure = ReadJSON(auctionHousesFilePath);
    allAuctionHouses = auctionsFile.auctionHouses;
  }

  const allAuctionHousesFromTerms = new Set<string>(terms.map((_) => _.auctionHouseAddress));
  for (const auctionHouseAddress of allAuctionHousesFromTerms) {
    if (allAuctionHouses.find((_) => _.address == auctionHouseAddress)) {
      // already known, not need to fetch data
    } else {
      const auctionHouseContract = AuctionHouse__factory.connect(auctionHouseAddress, web3Provider);
      const auctionHouse: AuctionHouseData = {
        address: auctionHouseAddress,
        midPoint: Number(await auctionHouseContract.midPoint()),
        duration: Number(await auctionHouseContract.auctionDuration())
      };

      allAuctionHouses.push(auctionHouse);
    }
  }

  const endDate = Date.now();
  const auctionsFile: AuctionHousesFileStructure = {
    auctionHouses: allAuctionHouses,
    updated: endDate,
    updatedHuman: new Date(endDate).toISOString()
  };

  WriteJSON(auctionHousesFilePath, auctionsFile);
  return allAuctionHouses;
}

async function fetchAndSaveProtocolData(web3Provider: JsonRpcProvider): Promise<ProtocolData> {
  const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), web3Provider);
  const creditMultiplier = await profitManagerContract.creditMultiplier();

  const data: ProtocolData = {
    creditMultiplier: creditMultiplier
  };

  const protocolDataPath = path.join(DATA_DIR, 'protocol-data.json');
  const fetchDate = Date.now();
  const protocolFileData: ProtocolDataFileStructure = {
    updated: fetchDate,
    updatedHuman: new Date(fetchDate).toISOString(),
    data: data
  };

  WriteJSON(protocolDataPath, protocolFileData);

  return data;
}

async function fetchAndSaveTerms(web3Provider: JsonRpcProvider, protocolData: ProtocolData) {
  const multicallProvider = MulticallWrapper.wrap(web3Provider);
  const guildTokenContract = GuildToken__factory.connect(GetGuildTokenAddress(), multicallProvider);
  const gauges = await GetGaugeForMarketId(guildTokenContract, MARKET_ID, false);
  const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), web3Provider);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const promises: any[] = [];
  promises.push(profitManagerContract.minBorrow());
  for (const lendingTermAddress of gauges) {
    Log(`FetchECGData: adding call for on lending term ${lendingTermAddress}`);
    const lendingTermContract = LendingTerm__factory.connect(lendingTermAddress, multicallProvider);
    promises.push(lendingTermContract.getParameters());
    promises.push(lendingTermContract.issuance());
    promises.push(lendingTermContract['debtCeiling()']());
    promises.push(lendingTermContract.auctionHouse());
  }

  // wait the promises
  Log(`FetchECGData[Terms]: sending ${promises.length} multicall`);
  await Promise.all(promises);
  Log('FetchECGData[Terms]: end multicall');

  const lendingTerms: LendingTerm[] = [];
  let cursor = 0;
  const minBorrow: bigint = await promises[cursor++];
  const creditMultiplier: bigint = protocolData.creditMultiplier;
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

  WriteJSON(lendingTermsPath, termFileData);
  return lendingTerms;
}

function getSyncData() {
  const syncDataPath = path.join(DATA_DIR, 'sync.json');
  if (!fs.existsSync(syncDataPath)) {
    // create the sync file
    const syncData: SyncData = {
      termSync: [],
      gaugeSync: {
        lastBlockFetched: GetDeployBlock()
      },
      auctionSync: []
    };

    WriteJSON(syncDataPath, syncData);

    return syncData;
  } else {
    const syncData: SyncData = ReadJSON(syncDataPath);
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

  Log('FetchECGData[Gauges]: getting gauges infos');

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
  const incrementGaugeEvents = await FetchAllEvents(
    guild,
    'GuildToken',
    'IncrementGaugeWeight',
    sinceBlock,
    currentBlock
  );
  for (const event of incrementGaugeEvents) {
    {
      gaugesFile.gauges[event.args.gauge] = gaugesFile.gauges[event.args.gauge] || {
        address: event.args.gauge,
        weight: 0n,
        lastLoss: 0,
        users: {}
      };
      gaugesFile.gauges[event.args.gauge].weight += event.args.weight;

      if (!gaugesFile.gauges[event.args.gauge].users[event.args.user]) {
        const block = await web3Provider.getBlock(event.blockNumber);
        if (!block) {
          throw new Error(`Cannot getBlock for ${event.blockNumber}`);
        }
        gaugesFile.gauges[event.args.gauge].users[event.args.user] = {
          address: event.args.user,
          weight: 0n,
          lastLossApplied: block.timestamp // default timestamp when incrementing gauge is block.timestamp
        };
      }

      gaugesFile.gauges[event.args.gauge].users[event.args.user].weight += event.args.weight;
    }
  }

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
    gaugesFile.gauges[event.args.gauge].users[event.args.who].lastLossApplied = Number(event.args.when);
  });

  gaugesFile.updated = Date.now();
  gaugesFile.updatedHuman = new Date().toISOString();
  WriteJSON(gaugesFilePath, gaugesFile);

  // save sync data
  syncData.gaugeSync = syncData.gaugeSync || {
    lastBlockFetched: 0
  };
  syncData.gaugeSync.lastBlockFetched = currentBlock;

  Log(`FetchECGData[Gauges]: Updated ${Object.keys(gaugesFile.gauges).length} gauges`);
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
    const loansFile: LoansFileStructure = ReadJSON(loansFilePath);
    alreadySavedLoans = loansFile.loans;
  }

  const updateLoans: LoansFileStructure = {
    loans: alreadySavedLoans.filter((_) => _.status == LoanStatus.CLOSED),
    updated: Date.now(),
    updatedHuman: new Date(Date.now()).toISOString()
  };

  const allNewLoansIds: { termAddress: string; loanId: string }[] = [];
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

    allNewLoansIds.push(
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

  // only get the loan ids from the previously known loans
  // that are not with the status closed, no use in updating loans
  // that are closed
  const allLoanIds = alreadySavedLoans
    .filter((_) => _.status != LoanStatus.CLOSED)
    .map((_) => {
      return { termAddress: _.lendingTermAddress, loanId: _.id };
    });

  // add all new loansId (from the newly fetched files)
  for (const newLoanId of allNewLoansIds) {
    if (!allLoanIds.some((_) => _.loanId == newLoanId.loanId && _.termAddress == newLoanId.termAddress)) {
      allLoanIds.push(newLoanId);
    }
  }

  // fetch data for all loans
  const allUpdatedLoans: Loan[] = await fetchLoansInfo(allLoanIds, web3Provider);
  updateLoans.loans.push(...allUpdatedLoans);
  const endDate = Date.now();
  updateLoans.updated = endDate;
  updateLoans.updatedHuman = new Date(endDate).toISOString();
  WriteJSON(loansFilePath, updateLoans);
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

  Log(`FetchECGData[Loans]: sending loans() multicall for ${allLoanIds.length} loans`);
  await Promise.all(promises);
  Log('FetchECGData[Loans]: end multicall');

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
    const auctionsFile: AuctionsFileStructure = ReadJSON(auctionsFilePath);
    alreadySavedAuctions = auctionsFile.auctions;
  }

  const updateAuctions: AuctionsFileStructure = {
    // keep the closed options here
    auctions: alreadySavedAuctions.filter((_) => _.status == AuctionStatus.CLOSED),
    updated: Date.now(),
    updatedHuman: new Date(Date.now()).toISOString()
  };

  const allNewLoansIds: { auctionHouseAddress: string; loanId: string }[] = [];
  const auctionsHouseAddresses = new Set<string>(terms.map((_) => _.auctionHouseAddress));
  const allAuctionEndEvents = [];
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

    const auctionEndEvents = await FetchAllEvents(
      auctionHouseContract,
      auctionHouseAddress,
      'AuctionEnd',
      sinceBlock,
      currentBlock
    );

    allAuctionEndEvents.push(...auctionEndEvents);

    allNewLoansIds.push(
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

  const allLoanIds = alreadySavedAuctions
    .filter((_) => _.status != AuctionStatus.CLOSED)
    .map((_) => {
      return { auctionHouseAddress: _.auctionHouseAddress, loanId: _.loanId };
    });

  for (const newLoanId of allNewLoansIds) {
    if (
      !allLoanIds.some((_) => _.loanId == newLoanId.loanId && _.auctionHouseAddress == newLoanId.auctionHouseAddress)
    ) {
      allLoanIds.push(newLoanId);
    }
  }

  // fetch data for all auctions
  const allUpdatedAuctions: Auction[] = await fetchAuctionsInfo(allLoanIds, terms, web3Provider);
  updateAuctions.auctions.push(...allUpdatedAuctions);

  // update auctions for all auctionEnd events
  for (const auctionEndEvent of allAuctionEndEvents) {
    const txHash = auctionEndEvent.transactionHash;
    const collateralSold = auctionEndEvent.args['collateralSold'];
    const debtRecovered = auctionEndEvent.args['debtRecovered'];
    const loanId = auctionEndEvent.args['loanId'];

    // find related auction
    const index = updateAuctions.auctions.findIndex((_) => _.loanId == loanId);
    if (index < 0) {
      throw new Error(`Cannot find auction for loanId: ${loanId}`);
    } else {
      updateAuctions.auctions[index].bidTxHash = txHash;
      updateAuctions.auctions[index].collateralSold = collateralSold.toString();
      updateAuctions.auctions[index].debtRecovered = debtRecovered.toString();
    }
  }

  const endDate = Date.now();
  updateAuctions.updated = endDate;
  updateAuctions.updatedHuman = new Date(endDate).toISOString();
  WriteJSON(auctionsFilePath, updateAuctions);
}

async function fetchAuctionsInfo(
  allLoanIds: { auctionHouseAddress: string; loanId: string }[],
  lendingTerms: LendingTerm[],
  web3Provider: JsonRpcProvider
): Promise<Auction[]> {
  const multicallProvider = MulticallWrapper.wrap(web3Provider);
  const promises: Promise<AuctionHouse.AuctionStructOutput>[] = [];
  for (const loansId of allLoanIds) {
    const auctionHouseContract = AuctionHouse__factory.connect(loansId.auctionHouseAddress, multicallProvider);
    promises.push(auctionHouseContract.getAuction(loansId.loanId));
  }

  Log(`FetchECGData[Auctions]: sending getAuction() multicall for ${allLoanIds.length} loans`);
  await Promise.all(promises);
  Log('FetchECGData[Auctions]: end multicall');

  let cursor = 0;
  const allAuctions: Auction[] = [];
  for (const loan of allLoanIds) {
    const auctionData = await promises[cursor++];

    const lendingTermAddress = auctionData.lendingTerm;
    const linkedLendingTerm = lendingTerms.find((_) => _.termAddress == auctionData.lendingTerm);
    if (!linkedLendingTerm) {
      throw new Error(`Cannot find lending term with address ${auctionData.lendingTerm}`);
    }

    allAuctions.push({
      loanId: loan.loanId,
      auctionHouseAddress: loan.auctionHouseAddress,
      startTime: Number(auctionData.startTime) * 1000,
      endTime: Number(auctionData.endTime) * 1000,
      callCreditMultiplier: auctionData.callCreditMultiplier.toString(10),
      callDebt: auctionData.callDebt.toString(10),
      collateralAmount: auctionData.collateralAmount.toString(10),
      lendingTermAddress: auctionData.lendingTerm,
      status: Number(auctionData.endTime) > 0 ? AuctionStatus.CLOSED : AuctionStatus.ACTIVE,
      bidTxHash: '',
      collateralSold: '0',
      debtRecovered: '0',
      collateralTokenAddress: linkedLendingTerm.collateralAddress
    });
  }

  return allAuctions;
}

export async function FetchIfTooOld() {
  if (lastFetch + SECONDS_BETWEEN_FETCHES * 1000 > Date.now()) {
    Log('FetchIfTooOld: no fetch needed');
  } else {
    Log('FetchIfTooOld: start fetching data');
    await FetchECGData();
  }
}
