import { JsonRpcProvider } from 'ethers';
import { GetDeployBlock } from '../../config/Config';
import { LendingTerm as LendingTermNamespace } from '../../contracts/types/LendingTerm';
import fs from 'fs';
import { LendingTerm__factory } from '../../contracts/types';
import { DATA_DIR } from '../../utils/Constants';
import path from 'path';
import { ReadJSON, WriteJSON } from '../../utils/Utils';
import { MulticallWrapper } from 'ethers-multicall-provider';
import LendingTerm from '../../model/LendingTerm';
import { Log } from '../../utils/Logger';
import { SyncData } from '../../model/SyncData';
import { Loan, LoanStatus, LoansFileStructure } from '../../model/Loan';
import { FetchAllEvents } from '../../utils/Web3Helper';

export default class LoansFetcher {
  static async fetchAndSaveLoans(
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

    // allNewLoansIds contains all loanIds opened from sinceBlock => currentBlock
    const allNewLoansIds = await fetchNewLoanOpen(terms, syncData, web3Provider, currentBlock);

    // only get the loan ids from the previously known loans
    // that are not with the status closed, no use in updating loans
    // that are closed
    const allLoanIds = alreadySavedLoans
      .filter((_) => _.status != LoanStatus.CLOSED)
      .map((_) => {
        return { termAddress: _.lendingTermAddress, loanId: _.id, txHashOpen: _.txHashOpen };
      });

    // add all new loansId (from the newly fetched files)
    for (const newLoanId of allNewLoansIds) {
      if (!allLoanIds.some((_) => _.loanId == newLoanId.loanId && _.termAddress == newLoanId.termAddress)) {
        allLoanIds.push({
          loanId: newLoanId.loanId,
          termAddress: newLoanId.termAddress,
          txHashOpen: newLoanId.txHash
        });
      }
    }

    // fetch data for all loans
    const allUpdatedLoans: Loan[] = await fetchLoansInfo(allLoanIds, web3Provider);
    updateLoans.loans.push(...allUpdatedLoans);

    await fetchClosedEventsAndUpdateLoans(terms, updateLoans.loans, web3Provider, syncData, currentBlock);

    // update term sync data
    for (const term of terms) {
      const termSyncData = syncData.termSync.find((_) => _.termAddress == term.termAddress);
      if (!termSyncData) {
        syncData.termSync.push({
          lastBlockFetched: currentBlock,
          termAddress: term.termAddress
        });
      } else {
        termSyncData.lastBlockFetched = currentBlock;
      }
    }
    const endDate = Date.now();
    updateLoans.updated = endDate;
    updateLoans.updatedHuman = new Date(endDate).toISOString();
    WriteJSON(loansFilePath, updateLoans);
  }
}

async function fetchNewLoanOpen(
  terms: LendingTerm[],
  syncData: SyncData,
  web3Provider: JsonRpcProvider,
  currentBlock: number
): Promise<{ termAddress: string; loanId: string; txHash: string }[]> {
  const allNewLoansIds: { termAddress: string; loanId: string; txHash: string }[] = [];
  for (const term of terms) {
    // check if we already have a sync data about this term
    const termSyncData = syncData.termSync.find((_) => _.termAddress == term.termAddress);
    let sinceBlock = GetDeployBlock();
    if (termSyncData) {
      sinceBlock = termSyncData.lastBlockFetched + 1;
    }

    const termContract = LendingTerm__factory.connect(term.termAddress, web3Provider);

    const loanOpenEvents = await FetchAllEvents(termContract, term.label, 'LoanOpen', sinceBlock, currentBlock);

    for (const loanOpenEvent of loanOpenEvents) {
      const loanId = loanOpenEvent.args['loanId'].toString();
      const txHash = loanOpenEvent.transactionHash;
      allNewLoansIds.push({
        loanId: loanId,
        termAddress: term.termAddress,
        txHash: txHash
      });
    }
  }

  return allNewLoansIds;
}

async function fetchLoansInfo(
  allLoanIds: { termAddress: string; loanId: string; txHashOpen: string }[],
  web3Provider: JsonRpcProvider
): Promise<Loan[]> {
  const multicallProvider = MulticallWrapper.wrap(web3Provider);
  const promises = [];
  for (const loanData of allLoanIds) {
    const lendingTermContract = LendingTerm__factory.connect(loanData.termAddress, multicallProvider);
    promises.push(lendingTermContract.getLoan(loanData.loanId));
    promises.push(lendingTermContract.getLoanDebt(loanData.loanId));
  }

  Log(`FetchECGData[Loans]: sending loans() multicall for ${allLoanIds.length} loans`);
  await Promise.all(promises);
  Log('FetchECGData[Loans]: end multicall');

  let cursor = 0;
  const allLoans: Loan[] = [];
  for (const loan of allLoanIds) {
    const loanData = (await promises[cursor++]) as LendingTermNamespace.LoanStructOutput;
    const loanDebt = (await promises[cursor++]) as bigint;
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
      lastPartialRepay: Number(loanData.lastPartialRepay) * 1000,
      borrowCreditMultiplier: loanData.borrowCreditMultiplier.toString(10),
      txHashOpen: loan.txHashOpen,
      txHashClose: '',
      loanDebt: loanDebt.toString(10),
      debtRepaid: '0'
    });
  }

  for (const loan of allLoans.filter((_) => _.status == LoanStatus.ACTIVE)) {
    if (loan.callTime > 0) {
      loan.status = LoanStatus.CALLED;
    }
  }

  return allLoans;
}

async function fetchClosedEventsAndUpdateLoans(
  terms: LendingTerm[],
  loans: Loan[],
  web3Provider: JsonRpcProvider,
  syncData: SyncData,
  currentBlock: number
) {
  for (const term of terms) {
    // check if we already have a sync data about this term
    const termSyncData = syncData.termSync.find((_) => _.termAddress == term.termAddress);
    let sinceBlock = GetDeployBlock();
    if (termSyncData) {
      sinceBlock = termSyncData.lastBlockFetched + 1;
    }

    const termContract = LendingTerm__factory.connect(term.termAddress, web3Provider);

    const loanCloseEvents = await FetchAllEvents(termContract, term.label, 'LoanClose', sinceBlock, currentBlock);

    for (const loanCloseEvent of loanCloseEvents) {
      const loanId = loanCloseEvent.args['loanId'].toString();
      const debtRepaid = loanCloseEvent.args['debtRepaid'].toString(10);
      // find the loan
      const loan = loans.find((_) => _.id == loanId);
      if (!loan) {
        throw new Error(`Data mismatch for loan id ${loanId}`);
      }
      const txHash = loanCloseEvent.transactionHash;
      loan.txHashClose = txHash;
      loan.debtRepaid = debtRepaid;
    }
  }
}
