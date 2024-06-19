import { MulticallWrapper } from 'ethers-multicall-provider';
import { GuildToken__factory, LendingTerm__factory } from '../../contracts/types';
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

class PartnershipController {
  static async GetEtherfiData(blockNumber: number, addresses: string[]): Promise<EtherfiResponse> {
    const GUILD_ADDRESS = '0xb8ae64F191F829fC00A4E923D460a8F2E0ba3978';
    const weETHAddress = '0x1c27Ad8a19Ba026ADaBD615F6Bc77158130cfBE4';

    const response: EtherfiResponse = {
      Result: []
    };

    const { allTerms, allLoans } = getAllTermsFromFile();

    const archivalProvider = GetArchiveWeb3Provider();
    const multicallProvider = MulticallWrapper.wrap(archivalProvider, 480_000);

    // fetch live terms at block
    const guildContract = GuildToken__factory.connect(GUILD_ADDRESS, archivalProvider);
    const allLiveGaugesAtBlock = await guildContract.liveGauges({ blockTag: blockNumber });

    // find all terms that have weETH as collateral
    const weETHTermsAtBlock: LendingTerm[] = allTerms.filter(
      (_) => allLiveGaugesAtBlock.includes(_.termAddress) && _.collateralAddress == weETHAddress
    );

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
      const normalizedAmount = norm(loanResult.collateralAmount);
      total += normalizedAmount;
      if (!borrowers[loan.borrowerAddress]) {
        borrowers[loan.borrowerAddress] = 0;
      }

      borrowers[loan.borrowerAddress] += normalizedAmount;
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
