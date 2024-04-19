import { JsonRpcProvider } from 'ethers';
import { MulticallWrapper } from 'ethers-multicall-provider';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../utils/Constants';
import { SyncData } from '../model/SyncData';
import { AuctionHouse, AuctionHouse__factory } from '../contracts/types';

import LendingTerm from '../model/LendingTerm';
import { GetDeployBlock } from '../config/Config';
import { ReadJSON, WriteJSON } from '../utils/Utils';
import { FetchAllEvents, FetchAllEventsAndExtractStringArray, GetWeb3Provider } from '../utils/Web3Helper';
import { Auction, AuctionStatus, AuctionsFileStructure } from '../model/Auction';
import { FileMutex } from '../utils/FileMutex';
import { Log } from '../utils/Logger';
import { SendNotifications } from '../utils/Notifications';
import { AuctionHouseData, AuctionHousesFileStructure } from '../model/AuctionHouse';
import ProtocolDataFetcher from './fetchers/ProtocolDataFetcher';
import LendingTermsFetcher from './fetchers/LendingTermsFetcher';
import LoansFetcher from './fetchers/LoansFetcher';
import GaugesFetcher from './fetchers/GaugesFetcher';

// amount of seconds between two fetches if no events on the protocol
const SECONDS_BETWEEN_FETCHES = 30 * 60;
let lastFetch = 0;

export async function FetchECGData() {
  await FileMutex.Lock();
  lastFetch = Date.now();
  try {
    const dtStart = performance.now();
    const web3Provider = GetWeb3Provider();
    const currentBlock = await web3Provider.getBlockNumber();
    Log(`FetchECGData: fetching data up to block ${currentBlock}`);

    const syncData: SyncData = getSyncData();
    Log('FetchECGData: start fetching');
    let fetchStart = performance.now();
    const protocolData = await ProtocolDataFetcher.fetchAndSaveProtocolData(web3Provider);
    Log(`FetchECGData: protocol data took: ${(performance.now() - fetchStart).toFixed(1)} ms`);
    fetchStart = performance.now();
    const terms = await LendingTermsFetcher.fetchAndSaveTerms(web3Provider);
    Log(`FetchECGData: terms data took: ${(performance.now() - fetchStart).toFixed(1)} ms`);
    fetchStart = performance.now();
    const gauges = await GaugesFetcher.fetchAndSaveGauges(web3Provider, syncData, currentBlock);
    Log(`FetchECGData: gauges data took: ${(performance.now() - fetchStart).toFixed(1)} ms`);
    fetchStart = performance.now();
    const loans = await LoansFetcher.fetchAndSaveLoans(web3Provider, terms, syncData, currentBlock);
    Log(`FetchECGData: loan data took: ${(performance.now() - fetchStart).toFixed(1)} ms`);
    fetchStart = performance.now();
    const auctions = await fetchAndSaveAuctions(web3Provider, terms, syncData, currentBlock);
    Log(`FetchECGData: auctions data took: ${(performance.now() - fetchStart).toFixed(1)} ms`);
    fetchStart = performance.now();
    const auctionsHouses = await fetchAndSaveAuctionHouses(web3Provider, terms);
    Log(`FetchECGData: auction house data took: ${(performance.now() - fetchStart).toFixed(1)} ms`);
    // unlock before fetching activities as it's not required for the node
    await FileMutex.Unlock();

    // await LastActivityFetcher.fetchAndSaveActivity(syncData, web3Provider, currentBlock, protocolData, terms);
    WriteJSON(path.join(DATA_DIR, 'sync.json'), syncData);
    const durationMs = performance.now() - dtStart;
    Log(`FetchECGData: finished fetching. Fetch duration: ${durationMs.toFixed(1)} ms`);
  } catch (e) {
    Log('FetchECGData: unknown failure', e);
    lastFetch = 0;
    await SendNotifications('Data Fetcher', 'Unknown exception when fetching data', JSON.stringify(e));
  } finally {
    await FileMutex.Unlock();
  }
}

async function fetchAndSaveAuctionHouses(web3Provider: JsonRpcProvider, terms: LendingTerm[]) {
  Log('FetchECGData[AuctionHouse]: starting');
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
  Log('FetchECGData[AuctionHouse]: ending');
  return allAuctionHouses;
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

async function fetchAndSaveAuctions(
  web3Provider: JsonRpcProvider,
  terms: LendingTerm[],
  syncData: SyncData,
  currentBlock: number
) {
  Log('FetchECGData[Auctions]: starting');
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
  Log('FetchECGData[Auctions]: ending');
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
