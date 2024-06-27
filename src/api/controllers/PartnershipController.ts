import { MulticallWrapper } from 'ethers-multicall-provider';
import {
  ERC20__factory,
  GuildToken__factory,
  LendingTermLens__factory,
  LendingTerm__factory
} from '../../contracts/types';
import { GetArchiveWeb3Provider } from '../../utils/Web3Helper';
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

class PartnershipController {
  static async GetCollateralData(
    blockNumber: number,
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
    const weETHTermsAtBlock: LendingTerm[] = allTerms.filter(
      (_) =>
        allLiveGaugesAtBlock.includes(_.termAddress) &&
        _.collateralAddress.toLowerCase() == collateralToken.address.toLowerCase()
    );

    console.log(weETHTermsAtBlock);

    // find all loans opened on those terms
    // those loans can be opened after the block but at least we're sure to have them all
    // we will multicall the getloan data for each
    const weETHLoans: Loan[] = allLoans.filter((_) =>
      weETHTermsAtBlock.map((_) => _.termAddress).includes(_.lendingTermAddress)
    );

    const promises = [];
    for (const weETHLoan of weETHLoans) {
      const lendingTermContract = LendingTerm__factory.connect(weETHLoan.lendingTermAddress, multicallProvider);
      promises.push(lendingTermContract.getLoan(weETHLoan.id, { blockTag: blockNumber }));
    }

    const results = await Promise.all(promises);

    let total = 0;
    const borrowers: { [holder: string]: number } = {};
    for (let i = 0; i < weETHLoans.length; i++) {
      const loan = weETHLoans[i];
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
}
export default PartnershipController;

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
    terms.push(...termFile.terms);
    loans.push(...loansFile.loans);
  }

  return { allTerms: terms, allLoans: loans };
}
