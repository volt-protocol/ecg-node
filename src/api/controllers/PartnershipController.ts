import { MulticallWrapper } from 'ethers-multicall-provider';
import {
  ERC20__factory,
  GuildToken__factory,
  LendingTermLens__factory,
  LendingTerm__factory
} from '../../contracts/types';
import { GetArchiveWeb3Provider, FetchAllEventsMulti } from '../../utils/Web3Helper';
import { EtherfiResponse } from '../model/PartnershipResponse';
import LendingTerm, { LendingTermsFileStructure } from '../../model/LendingTerm';
import { readdirSync } from 'fs';
import { GLOBAL_DATA_DIR } from '../../utils/Constants';
import path from 'path';
import { ReadJSON } from '../../utils/Utils';
import { Loan, LoansFileStructure } from '../../model/Loan';
import { norm } from '../../utils/TokenUtils';
import { Log } from '../../utils/Logger';
import { getTokenByAddress } from '../../config/Config';
import { HttpGet } from '../../utils/HttpHelper';

interface UserData {
  amount: number; // this can be a collateral or a credit token amount
  currentWeight: number;
}

class PartnershipController {
  static async GetCollateralData(
    blockNumber: number | undefined,
    addresses: string[],
    collateralTokenAddress: string
  ): Promise<EtherfiResponse> {
    const GUILD_ADDRESS = '0xb8ae64F191F829fC00A4E923D460a8F2E0ba3978';
    const collateralToken = await getTokenByAddress(collateralTokenAddress);

    const response: EtherfiResponse = {
      Result: []
    };

    const { allTerms, allLoans } = getAllTermsFromFile();

    const archivalProvider = GetArchiveWeb3Provider();
    const multicallProvider = MulticallWrapper.wrap(archivalProvider, 480_000);

    // fetch live terms at block
    const guildContract = GuildToken__factory.connect(GUILD_ADDRESS, archivalProvider);
    const allLiveGaugesAtBlock = await guildContract.liveGauges({ blockTag: blockNumber });

    // find all terms that have 'collateralToken' as collateral
    const termsAtBlock: LendingTerm[] = allTerms.filter(
      (_) =>
        allLiveGaugesAtBlock.includes(_.termAddress) &&
        _.collateralAddress.toLowerCase() == collateralToken.address.toLowerCase()
    );

    // find all loans opened on those terms
    // those loans can be opened after the block but at least we're sure to have them all
    // we will multicall the getloan data for each
    const loans: Loan[] = allLoans.filter((_) => termsAtBlock.map((_) => _.termAddress).includes(_.lendingTermAddress));

    const promises = [];
    for (const loan of loans) {
      const lendingTermContract = LendingTerm__factory.connect(loan.lendingTermAddress, multicallProvider);
      promises.push(lendingTermContract.getLoan(loan.id, { blockTag: blockNumber }));
    }

    const results = await Promise.all(promises);

    let total = 0;
    const borrowers: { [holder: string]: number } = {};
    for (let i = 0; i < loans.length; i++) {
      const loan = loans[i];
      const loanResult = results[i];
      // only sum collateral for non closed loans
      if (loanResult.closeTime == 0n) {
        const normalizedAmount = norm(loanResult.collateralAmount);
        total += normalizedAmount;
        if (!borrowers[loan.borrowerAddress]) {
          borrowers[loan.borrowerAddress] = 0;
        }

        borrowers[loan.borrowerAddress] += normalizedAmount;
      }
    }

    Log(`GetEtherfiData: total ${total} weETH at block ${blockNumber}`);

    for (const [borrower, amount] of Object.entries(borrowers)) {
      if (addresses.length == 0 || addresses.map((_) => _.toLowerCase()).includes(borrower.toLowerCase())) {
        if (amount > 0) {
          response.Result.push({
            address: borrower,
            effective_balance: amount
          });
        }
      }
    }

    // if addresses.length == 0, check that no token was airdropped some tokens to the terms
    // if so, it will create a difference as sum(holders) will not be equals to the sum of balanceOf()
    // of all terms at block
    if (addresses.length == 0) {
      const lens = LendingTermLens__factory.connect('0x97fEba5C154AA37680Fdf7e3FeA5386460Ef9f52', multicallProvider);
      const allTermsForToken = await lens.getTermsForToken(collateralTokenAddress);
      console.log(allTermsForToken);
      const erc20Contract = ERC20__factory.connect(collateralTokenAddress, multicallProvider);
      const balanceOfResults = await Promise.all(
        allTermsForToken.map((_) => erc20Contract.balanceOf(_, { blockTag: blockNumber }))
      );
      let sum = 0n;
      for (const balance of balanceOfResults) {
        sum += balance;
      }

      if (sum > 0n) {
        const sumBalanceOfNorm = norm(sum, collateralToken.decimals);
        if (total < sumBalanceOfNorm) {
          // add difference to bad beef :)
          response.Result.push({
            address: '0xbad06297eB7878502E045319a7c4a8904b49BEEF',
            effective_balance: sumBalanceOfNorm - total
          });
        }
      }
    }

    return response;
  }

  static async GetBorrowerWeightsData(
    collateralToken: string,
    startDate: string,
    endDate: string
  ): Promise<{ [user: string]: string }> {
    const { allTerms, allLoans } = getAllTermsFromFile();

    const collateralTerms = allTerms.filter((_) => _.collateralAddress.toLowerCase() == collateralToken.toLowerCase());
    const loansWithCollateral = allLoans.filter((loan) =>
      collateralTerms.map((t) => t.termAddress).includes(loan.lendingTermAddress)
    );

    const archivalProvider = GetArchiveWeb3Provider();
    const multicallProvider = MulticallWrapper.wrap(archivalProvider, 480_000);

    const startBlock = await getBlockAtTimestamp('arbitrum', new Date(startDate).getTime() / 1000);
    const endBlock = await getBlockAtTimestamp('arbitrum', new Date(endDate).getTime() / 1000);

    const usersData: { [userAddress: string]: UserData } = {};

    // get base data at startDate
    // to do that we fetch the getLoan historically for ALL THE LOANS
    // if a loan does not exists yet, it will just return the default value (empty getLoanData)
    const promises = [];
    for (const loan of loansWithCollateral) {
      const lendingTermContract = LendingTerm__factory.connect(loan.lendingTermAddress, multicallProvider);
      promises.push(lendingTermContract.getLoan(loan.id, { blockTag: startBlock }));
    }

    const results = await Promise.all(promises);

    for (let i = 0; i < loansWithCollateral.length; i++) {
      const loan = loansWithCollateral[i];
      const loanResult = results[i];
      // only sum collateral for non closed loans
      if (loanResult.closeTime == 0n) {
        const normalizedAmount = norm(loanResult.collateralAmount);
        if (!usersData[loan.borrowerAddress]) {
          usersData[loan.borrowerAddress] = { amount: 0, currentWeight: 0 };
        }

        usersData[loan.borrowerAddress].amount += normalizedAmount;
      }
    }

    // here we have all the borrowers with their amount of pt-usde at startDate
    //console.log(`At block ${startBlock}, current weights:`, usersData);

    // fetch all loan open / loan close events from all terms
    const termContractInterface = LendingTerm__factory.createInterface();

    const filters = [
      termContractInterface.encodeFilterTopics('LoanOpen', []).toString(),
      termContractInterface.encodeFilterTopics('LoanClose', []).toString()
    ];

    const loanEvents = await FetchAllEventsMulti(
      termContractInterface,
      collateralTerms.map((_) => _.termAddress),
      [filters],
      startBlock,
      endBlock,
      archivalProvider
    );
    // console.log(loanEvents);

    // here, we have all the loan open / loan close events for all the terms
    // we can now update usersData for each event in the correct order (of received events, already sorted), thanks ethers

    let lastComputeBlock = startBlock;
    for (const event of loanEvents) {
      const eventBlock = event.blockNumber;
      const nbElapsedBlocks = eventBlock - lastComputeBlock;

      // if two events are in the same block, we don't compute weight two time
      if (nbElapsedBlocks > 0) {
        // compute time weighted avg with each user holding (before applying new data from this event)
        for (const user of Object.keys(usersData)) {
          usersData[user].currentWeight += usersData[user].amount * nbElapsedBlocks;
        }

        //console.log(`At block ${eventBlock}, current weights:`, usersData);

        lastComputeBlock = eventBlock;
      }

      // in any case, update users data, even if two events in the same block
      // and update usersData for this event
      if (event.logName == 'LoanOpen') {
        // new loan so we add the amount to the amount of pt usde the user has
        if (!usersData[event.args.borrower]) {
          usersData[event.args.borrower] = { amount: 0, currentWeight: 0 };
        }

        usersData[event.args.borrower].amount += norm(event.args.collateralAmount);
      } else if (event.logName == 'LoanClose') {
        // loan closed so we remove the amount from the amount of pt usde the user has
        // but the collateral amount is not in the event, so we'll get it from the loans list we have
        const loan = loansWithCollateral.find((_) => _.id == event.args.loanId);
        if (!loan) {
          throw new Error(`Loan ${event.args.loanId} not found`);
        }

        if (!usersData[loan.borrowerAddress]) {
          throw new Error(`User ${event.args.borrower} not found in user data but we got a loan close event`);
        }
        usersData[event.args.borrower].amount -= norm(loan.collateralAmount);
      }
    }

    // in the end, compute for last block
    if (lastComputeBlock < endBlock) {
      const nbElapsedBlocks = endBlock - lastComputeBlock;
      // compute time weighted avg with each user holding (before applying new data from this event)
      for (const user of Object.keys(usersData)) {
        usersData[user].currentWeight += usersData[user].amount * nbElapsedBlocks;
      }
    }

    const resultUnsorted = Object.keys(usersData).reduce(function (result: { [user: string]: string }, userAddress) {
      result[userAddress] = result[userAddress] || '0';
      result[userAddress] = (
        BigInt(result[userAddress]) + BigInt(Math.round(usersData[userAddress].currentWeight))
      ).toString();
      return result;
    }, {});
    const resultSorted = Object.keys(resultUnsorted)
      .sort(function (a, b) {
        return BigInt(resultUnsorted[a]) < BigInt(resultUnsorted[b]) ? 1 : -1;
      })
      .reduce(function (result: { [user: string]: string }, userAddress) {
        result[userAddress] = resultUnsorted[userAddress] || '0';
        return result;
      }, {});
    return resultSorted;
  }

  static async GetBorrowerWeightsDataForMarket(
    marketId: number,
    startDate: string,
    endDate: string
  ): Promise<{ [user: string]: string }> {
    const { allTerms, allLoans } = getAllTermsFromFile(marketId);

    const archivalProvider = GetArchiveWeb3Provider();
    const multicallProvider = MulticallWrapper.wrap(archivalProvider, 480_000);

    const startBlock = await getBlockAtTimestamp('arbitrum', new Date(startDate).getTime() / 1000);
    const endBlock = await getBlockAtTimestamp('arbitrum', new Date(endDate).getTime() / 1000);

    const usersData: { [userAddress: string]: UserData } = {};

    // get base data at startDate
    // to do that we fetch the getLoan historically for ALL THE LOANS
    // if a loan does not exists yet, it will just return the default value (empty getLoanData)
    const promises = [];
    for (const loan of allLoans) {
      const lendingTermContract = LendingTerm__factory.connect(loan.lendingTermAddress, multicallProvider);
      promises.push(lendingTermContract.getLoan(loan.id, { blockTag: startBlock }));
    }

    const results = await Promise.all(promises);

    for (let i = 0; i < allLoans.length; i++) {
      const loan = allLoans[i];
      const loanResult = results[i];
      // only sum borrow amount for non closed loans
      if (loanResult.closeTime == 0n) {
        const normalizedAmount = norm(loanResult.borrowAmount);
        if (!usersData[loan.borrowerAddress]) {
          usersData[loan.borrowerAddress] = { amount: 0, currentWeight: 0 };
        }

        usersData[loan.borrowerAddress].amount += normalizedAmount;
      }
    }

    // here we have all the borrowers with their amount of pt-usde at startDate
    //console.log(`At block ${startBlock}, current weights:`, usersData);

    // fetch all loan open / loan close events from all terms
    const termContractInterface = LendingTerm__factory.createInterface();

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

    // here, we have all the loan open / loan close events for all the terms
    // we can now update usersData for each event in the correct order (of received events, already sorted), thanks ethers

    let lastComputeBlock = startBlock;
    for (const event of loanEvents) {
      const eventBlock = event.blockNumber;
      const nbElapsedBlocks = eventBlock - lastComputeBlock;

      // if two events are in the same block, we don't compute weight two time
      if (nbElapsedBlocks > 0) {
        // compute time weighted avg with each user holding (before applying new data from this event)
        for (const user of Object.keys(usersData)) {
          usersData[user].currentWeight += usersData[user].amount * nbElapsedBlocks;
        }

        //console.log(`At block ${eventBlock}, current weights:`, usersData);

        lastComputeBlock = eventBlock;
      }

      // in any case, update users data, even if two events in the same block
      // and update usersData for this event
      if (event.logName == 'LoanOpen') {
        // new loan so we add the amount to the amount of pt usde the user has
        if (!usersData[event.args.borrower]) {
          usersData[event.args.borrower] = { amount: 0, currentWeight: 0 };
        }

        usersData[event.args.borrower].amount += norm(event.args.borrowAmount);
      } else if (event.logName == 'LoanClose') {
        // loan closed so we remove the amount from the amount of pt usde the user has
        // but the collateral amount is not in the event, so we'll get it from the loans list we have
        const loan = allLoans.find((_) => _.id == event.args.loanId);
        if (!loan) {
          throw new Error(`Loan ${event.args.loanId} not found`);
        }

        if (!usersData[loan.borrowerAddress]) {
          throw new Error(`User ${event.args.borrower} not found in user data but we got a loan close event`);
        }
        usersData[loan.borrowerAddress].amount -= norm(loan.borrowAmount);
      }
    }

    // in the end, compute for last block
    if (lastComputeBlock < endBlock) {
      const nbElapsedBlocks = endBlock - lastComputeBlock;
      // compute time weighted avg with each user holding (before applying new data from this event)
      for (const user of Object.keys(usersData)) {
        usersData[user].currentWeight += usersData[user].amount * nbElapsedBlocks;
      }
    }

    const resultUnsorted = Object.keys(usersData).reduce(function (result: { [user: string]: string }, userAddress) {
      result[userAddress] = result[userAddress] || '0';
      result[userAddress] = (
        BigInt(result[userAddress]) + BigInt(Math.round(usersData[userAddress].currentWeight))
      ).toString();
      return result;
    }, {});
    const resultSorted = Object.keys(resultUnsorted)
      .sort(function (a, b) {
        return BigInt(resultUnsorted[a]) < BigInt(resultUnsorted[b]) ? 1 : -1;
      })
      .reduce(function (result: { [user: string]: string }, userAddress) {
        result[userAddress] = resultUnsorted[userAddress] || '0';
        return result;
      }, {});
    return resultSorted;
  }
}
export default PartnershipController;

function getAllTermsFromFile(selectedMarketId?: number): { allTerms: LendingTerm[]; allLoans: Loan[] } {
  const terms: LendingTerm[] = [];
  const loans: Loan[] = [];
  const marketDirs = readdirSync(GLOBAL_DATA_DIR).filter((_) => _.startsWith('market_'));
  for (const marketDir of marketDirs) {
    const marketId = marketDir.split('_')[1];
    if (Number(marketId) > 1e6) {
      // ignore test market
      continue;
    }

    // only fetch from selectedMarketid if set
    if (selectedMarketId && Number(marketId) !== selectedMarketId) {
      continue;
    }

    const marketPath = path.join(GLOBAL_DATA_DIR, marketDir);
    const termsFilename = path.join(marketPath, 'terms.json');
    const loansFilename = path.join(marketPath, 'loans.json');
    const termFile: LendingTermsFileStructure = ReadJSON(termsFilename);
    const loansFile: LoansFileStructure = ReadJSON(loansFilename);
    terms.push(...termFile.terms);
    loans.push(...loansFile.loans);
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
