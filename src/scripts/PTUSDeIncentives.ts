import { readdirSync } from 'fs';
import path from 'path';
import LendingTerm, { LendingTermsFileStructure } from '../model/LendingTerm';
import { Loan, LoansFileStructure } from '../model/Loan';
import { GLOBAL_DATA_DIR } from '../utils/Constants';
import { ReadJSON } from '../utils/Utils';
import { HttpGet } from '../utils/HttpHelper';
import { FetchAllEventsMulti, GetArchiveWeb3Provider } from '../utils/Web3Helper';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { LendingTerm__factory } from '../contracts/types';
import { norm } from '../utils/TokenUtils';

const PT_USDE_ADDRESS = '0xad853EB4fB3Fe4a66CdFCD7b75922a0494955292';
interface UserData {
  amountPtUsde: number;
  currentWeight: number;
}
async function computeIncentives() {
  const archivalProvider = GetArchiveWeb3Provider();
  const multicallProvider = MulticallWrapper.wrap(archivalProvider, 480_000);

  const startDate = new Date('2024-06-20T00:00:00.000Z');
  const startBlock = await getBlockAtTimestamp('arbitrum', startDate.getTime() / 1000);
  const endDate = new Date('2024-07-10T00:00:00.000Z');
  const endBlock = await getBlockAtTimestamp('arbitrum', endDate.getTime() / 1000);

  const usersData: { [userAddress: string]: UserData } = {};
  // get all terms with pt-usde as collateral
  const { allTerms, allLoans } = getAllTermsFromFile();
  // get base data at startDate

  const promises = [];
  for (const loan of allLoans) {
    const lendingTermContract = LendingTerm__factory.connect(loan.lendingTermAddress, multicallProvider);
    promises.push(lendingTermContract.getLoan(loan.id, { blockTag: startBlock }));
  }

  const results = await Promise.all(promises);

  for (let i = 0; i < allLoans.length; i++) {
    const loan = allLoans[i];
    const loanResult = results[i];
    // only sum collateral for non closed loans
    if (loanResult.closeTime == 0n) {
      const normalizedAmount = norm(loanResult.collateralAmount);
      if (!usersData[loan.borrowerAddress]) {
        usersData[loan.borrowerAddress] = { amountPtUsde: 0, currentWeight: 0 };
      }

      usersData[loan.borrowerAddress].amountPtUsde += normalizedAmount;
    }
  }

  // here we have all the borrowers with their amount of pt-usde at startDate
  console.log(`At block ${startBlock}, current weights:`, usersData);

  // fetch all loan open / loan close events from all terms

  const termContractInterface = LendingTerm__factory.createInterface();
  const loanOpenTopic = termContractInterface.encodeFilterTopics('LoanOpen', []);
  const loanCloseTopic = termContractInterface.encodeFilterTopics('LoanClose', []);

  const filters = [
    termContractInterface.encodeFilterTopics('LoanOpen', []).toString(),
    termContractInterface.encodeFilterTopics('LoanClose', []).toString()
  ];

  const loanEvents = await FetchAllEventsMulti(
    termContractInterface,
    allTerms.map((_) => _.termAddress),
    [filters],
    startBlock,
    endBlock,
    archivalProvider
  );
  // console.log(loanEvents);

  // compute time weighted avg
  let lastComputeBlock = startBlock;
  for (const event of loanEvents) {
    const eventBlock = event.blockNumber;
    const nbElapsedBlocks = eventBlock - lastComputeBlock;
    if (nbElapsedBlocks > 0) {
      // compute time weighted avg with each user holding (before applying new data from this event)
      for (const user of Object.keys(usersData)) {
        usersData[user].currentWeight += usersData[user].amountPtUsde * nbElapsedBlocks;
      }

      console.log(`At block ${eventBlock}, current weights:`, usersData);

      lastComputeBlock = eventBlock;
    }

    // and update usersData for this event
    if (event.logName == 'LoanOpen') {
      // new loan so we add the amount to the amount of pt usde the user has
      if (!usersData[event.args.borrower]) {
        usersData[event.args.borrower] = { amountPtUsde: 0, currentWeight: 0 };
      }

      usersData[event.args.borrower].amountPtUsde += norm(event.args.collateralAmount);
    } else if (event.logName == 'LoanClose') {
      // loan closed so we remove the amount from the amount of pt usde the user has
      // but the collateral amount is not in the event, so we'll get it from the loans list we have
      const loan = allLoans.find((_) => _.id == event.args.loanId);
      if (!loan) {
        throw new Error(`Loan ${event.args.loanId} not found`);
      }
      if (!usersData[event.args.borrower]) {
        usersData[event.args.borrower] = { amountPtUsde: 0, currentWeight: 0 };
      }
      usersData[event.args.borrower].amountPtUsde -= norm(loan?.collateralAmount);
    }
  }

  // in the end, compute for last block
  if (lastComputeBlock < endBlock) {
    const nbElapsedBlocks = endBlock - lastComputeBlock;
    // compute time weighted avg with each user holding (before applying new data from this event)
    for (const user of Object.keys(usersData)) {
      usersData[user].currentWeight += usersData[user].amountPtUsde * nbElapsedBlocks;
    }
  }

  console.log('-------------------------------------');
  console.log('Final weights:');
  console.log(usersData);

  // to csv
  const csv = Object.entries(usersData)
    .map(([user, data]) => `${user},${data.amountPtUsde},${data.currentWeight}`)
    .join('\n');
  console.log('user,last collateral amount,weight');
  console.log(csv);
}

function getAllTermsFromFile(): { allTerms: LendingTerm[]; allLoans: Loan[] } {
  const terms: LendingTerm[] = [];
  const loans: Loan[] = [];
  const marketDirs = readdirSync(GLOBAL_DATA_DIR).filter((_) => _.startsWith('market_'));
  for (const marketDir of marketDirs) {
    const marketId = marketDir.split('_')[1];
    if (Number(marketId) > 1e6) {
      // ignore test market
      continue;
    }

    const marketPath = path.join(GLOBAL_DATA_DIR, marketDir);
    const termsFilename = path.join(marketPath, 'terms.json');
    const loansFilename = path.join(marketPath, 'loans.json');
    const termFile: LendingTermsFileStructure = ReadJSON(termsFilename);
    const loansFile: LoansFileStructure = ReadJSON(loansFilename);
    const ptusdeTerms = termFile.terms.filter((_) => _.collateralAddress == PT_USDE_ADDRESS);
    terms.push(...ptusdeTerms);

    const loansOnPtusdeTerms = loansFile.loans.filter((loan) =>
      ptusdeTerms.map((t) => t.termAddress).includes(loan.lendingTermAddress)
    );

    loans.push(...loansOnPtusdeTerms);
  }

  return { allTerms: terms, allLoans: loans };
}

interface BlockResponse {
  height: number;
  timestamp: number;
}

// Function to get the block at a specific timestamp
async function getBlockAtTimestamp(chain: string, timestamp: number): Promise<number> {
  const response = await HttpGet<BlockResponse>(`https://coins.llama.fi/block/${chain}/${timestamp}`);
  return response.height;
}

computeIncentives();
