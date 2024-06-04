import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../utils/Constants';
import { SyncData } from '../model/SyncData';
import { GetDeployBlock } from '../config/Config';
import { ReadJSON, WriteJSON } from '../utils/Utils';
import { GetWeb3Provider } from '../utils/Web3Helper';
import { FileMutex } from '../utils/FileMutex';
import logger from '../utils/Logger';
import { SendNotifications } from '../utils/Notifications';
import ProtocolDataFetcher from './fetchers/ProtocolDataFetcher';
import LendingTermsFetcher from './fetchers/LendingTermsFetcher';
import LoansFetcher from './fetchers/LoansFetcher';
import GaugesFetcher from './fetchers/GaugesFetcher';
import TermsProposalFetcher from './fetchers/TermsProposalFetcher';
import AuctionsFetcher from './fetchers/AuctionsFetcher';

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
    logger.debug(`FetchECGData: fetching data up to block ${currentBlock}`);

    const syncData: SyncData = getSyncData();
    logger.debug('FetchECGData: start fetching');
    let fetchStart = performance.now();
    const protocolData = await ProtocolDataFetcher.fetchAndSaveProtocolData(web3Provider);
    logger.debug(`FetchECGData: protocol data took: ${(performance.now() - fetchStart).toFixed(1)} ms`);
    fetchStart = performance.now();
    const terms = await LendingTermsFetcher.fetchAndSaveTerms(web3Provider, currentBlock);
    logger.debug(`FetchECGData: terms data took: ${(performance.now() - fetchStart).toFixed(1)} ms`);
    fetchStart = performance.now();
    const loans = await LoansFetcher.fetchAndSaveLoans(web3Provider, terms, syncData, currentBlock);
    logger.debug(`FetchECGData: loan data took: ${(performance.now() - fetchStart).toFixed(1)} ms`);
    fetchStart = performance.now();
    const gauges = await GaugesFetcher.fetchAndSaveGauges(web3Provider, syncData, currentBlock);
    logger.debug(`FetchECGData: gauges data took: ${(performance.now() - fetchStart).toFixed(1)} ms`);
    fetchStart = performance.now();
    const auctions = await AuctionsFetcher.fetchAndSaveAuctions(web3Provider, terms, syncData, currentBlock);
    logger.debug(`FetchECGData: auctions data took: ${(performance.now() - fetchStart).toFixed(1)} ms`);
    fetchStart = performance.now();
    const auctionsHouses = await AuctionsFetcher.fetchAndSaveAuctionHouses(web3Provider, terms);
    logger.debug(`FetchECGData: auction house data took: ${(performance.now() - fetchStart).toFixed(1)} ms`);
    fetchStart = performance.now();
    const proposals = await TermsProposalFetcher.fetchProposals(web3Provider, syncData, currentBlock);
    logger.debug(`FetchECGData: fetchProposals data took: ${(performance.now() - fetchStart).toFixed(1)} ms`);
    WriteJSON(path.join(DATA_DIR, 'sync.json'), syncData);
    const durationMs = performance.now() - dtStart;
    logger.debug(`FetchECGData: finished fetching. Fetch duration: ${durationMs.toFixed(1)} ms`);
  } catch (e) {
    logger.debug('FetchECGData: unknown failure', e);
    lastFetch = 0;
    await SendNotifications('Data Fetcher', 'Unknown exception when fetching data', JSON.stringify(e));
  } finally {
    await FileMutex.Unlock();
  }
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

export async function FetchIfTooOld() {
  if (lastFetch + SECONDS_BETWEEN_FETCHES * 1000 > Date.now()) {
    logger.debug('FetchIfTooOld: no fetch needed');
  } else {
    logger.debug('FetchIfTooOld: start fetching data');
    await FetchECGData();
  }
}
