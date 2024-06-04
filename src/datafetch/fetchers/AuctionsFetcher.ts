import { JsonRpcProvider } from 'ethers';
import { GetDeployBlock } from '../../config/Config';
import fs from 'fs';
import { AuctionHouse, AuctionHouse__factory } from '../../contracts/types';
import { DATA_DIR } from '../../utils/Constants';
import path from 'path';
import { ReadJSON, WriteJSON } from '../../utils/Utils';
import { SyncData } from '../../model/SyncData';
import { FetchAllEvents, FetchAllEventsAndExtractStringArray } from '../../utils/Web3Helper';
import { Auction, AuctionStatus, AuctionsFileStructure } from '../../model/Auction';
import LendingTerm from '../../model/LendingTerm';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { AuctionHouseData, AuctionHousesFileStructure } from '../../model/AuctionHouse';
import logger from '../../utils/Logger';

export default class AuctionsFetcher {
  static async fetchAndSaveAuctions(
    web3Provider: JsonRpcProvider,
    terms: LendingTerm[],
    syncData: SyncData,
    currentBlock: number
  ) {
    logger.info('FetchECGData[Auctions]: starting');
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
      updateBlock: currentBlock,
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
        // if not found, it means it might be on another market
        logger.debug(`Ignoring auction end for loan ${loanId}`);
        continue;
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
    logger.debug('FetchECGData[Auctions]: ending');
  }

  static async fetchAndSaveAuctionHouses(web3Provider: JsonRpcProvider, terms: LendingTerm[]) {
    logger.debug('FetchECGData[AuctionHouse]: starting');
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
    logger.debug('FetchECGData[AuctionHouse]: ending');
    return allAuctionHouses;
  }
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

  logger.debug(`FetchECGData[Auctions]: sending getAuction() multicall for ${allLoanIds.length} loans`);
  await Promise.all(promises);
  logger.debug('FetchECGData[Auctions]: end multicall');

  let cursor = 0;
  const allAuctions: Auction[] = [];
  for (const loan of allLoanIds) {
    const auctionData = await promises[cursor++];

    const linkedLendingTerm = lendingTerms.find((_) => _.termAddress == auctionData.lendingTerm);
    if (!linkedLendingTerm) {
      // if not found, it means it might be on another market
      logger.debug(`Ignoring auction for loan ${loan.loanId} and lending term ${auctionData.lendingTerm}`);
      continue;
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
