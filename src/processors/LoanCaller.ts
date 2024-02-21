import { existsSync } from 'node:fs';
import { ReadJSON, WaitUntilScheduled, sleep } from '../utils/Utils';
import path from 'path';
import { DATA_DIR } from '../utils/Constants';
import { ethers } from 'ethers';
import LendingTerm, { LendingTermStatus, LendingTermsFileStructure } from '../model/LendingTerm';
import { Loan, LoanStatus, LoansFileStructure } from '../model/Loan';
import { LendingTerm__factory, ProfitManager__factory } from '../contracts/types';
import { GetProfitManagerAddress } from '../config/Config';

const RUN_EVERY_SEC = 15;
const MS_PER_YEAR = 31_557_600_000; // 365.25 days per year
async function LoanCaller() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'LOAN_CALLER';
    console.log('LoanCaller: starting');
    const startDate = Date.now();
    const termsFilename = path.join(DATA_DIR, 'terms.json');
    const loansFilename = path.join(DATA_DIR, 'loans.json');
    checks(termsFilename, loansFilename);

    const termFileData: LendingTermsFileStructure = ReadJSON(termsFilename);
    const loanFileData: LoansFileStructure = ReadJSON(loansFilename);

    const rpcURL = process.env.RPC_URL;
    if (!rpcURL) {
      throw new Error('Cannot find RPC_URL in env');
    }
    const web3Provider = new ethers.JsonRpcProvider(rpcURL);
    const lastBlockTimestamp = (await web3Provider.getBlock(await web3Provider.getBlockNumber()))?.timestamp;
    if (!lastBlockTimestamp) {
      await WaitUntilScheduled(startDate, RUN_EVERY_SEC);
      continue;
    }

    const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), web3Provider);

    const creditMultiplier = await profitManagerContract.creditMultiplier();

    const loansToCall: { [termAddress: string]: string[] } = {};

    const loansToCheck = loanFileData.loans.filter((_) => _.status == LoanStatus.ACTIVE);
    console.log(`LoanCaller: will check ${loansToCheck.length} loans`);

    for (const loan of loansToCheck) {
      const term = termFileData.terms.find((_) => _.termAddress == loan.lendingTermAddress);
      if (!term) {
        throw new Error(`CANNOT FIND TERM ${loan.lendingTermAddress} IN FILE`);
      }

      const termDeprecated = term.status != LendingTermStatus.LIVE;
      const aboveMaxBorrow = checkAboveMaxBorrow(loan, term, creditMultiplier, lastBlockTimestamp);
      const partialRepayDelayPassed = checkPartialRepayDelayPassed(loan, term);

      if (termDeprecated || aboveMaxBorrow || partialRepayDelayPassed) {
        console.log(
          `LoanCaller: Call needed on Term: ${term.termAddress} / loan ${loan.id} ` +
            `(termDeprecated: ${termDeprecated}, aboveMaxBorrow: ${aboveMaxBorrow}, partialRepayDelayPassed: ${partialRepayDelayPassed})`
        );
        if (!loansToCall[loan.lendingTermAddress]) {
          loansToCall[loan.lendingTermAddress] = [];
        }

        loansToCall[loan.lendingTermAddress].push(loan.id);
      }
    }

    // call if any
    await callMany(loansToCall, web3Provider);
    console.log(`LoanCaller: sleeping ${RUN_EVERY_SEC} seconds`);
    await sleep(RUN_EVERY_SEC * 1000);
  }
}

async function callMany(loansToCall: { [termAddress: string]: string[] }, web3Provider: ethers.JsonRpcProvider) {
  if (!process.env.ETH_PRIVATE_KEY) {
    throw new Error('Cannot find ETH_PRIVATE_KEY in env');
  }

  const signer = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, web3Provider);

  for (const [termAddress, loanIds] of Object.entries(loansToCall)) {
    const lendingTermContract = LendingTerm__factory.connect(termAddress, signer);

    const callManyResponse = await lendingTermContract.callMany(loanIds);

    await callManyResponse.wait();
  }
}

function checkAboveMaxBorrow(loan: Loan, term: LendingTerm, creditMultiplier: bigint, lastBlockTimestampSec: number) {
  const maxBorrow = (BigInt(loan.collateralAmount) * BigInt(term.maxDebtPerCollateralToken)) / creditMultiplier;
  const interest =
    (BigInt(loan.borrowAmount) *
      BigInt(term.interestRate) *
      (BigInt(lastBlockTimestampSec * 1000) - BigInt(loan.originationTime))) /
    BigInt(MS_PER_YEAR) /
    10n ** 18n;
  const openingFee = (BigInt(loan.borrowAmount) * BigInt(term.openingFee)) / 10n ** 18n;

  const loanDebt = BigInt(loan.borrowAmount) + interest + openingFee;
  return loanDebt > maxBorrow;
}

function checkPartialRepayDelayPassed(loan: Loan, term: LendingTerm) {
  // if no periodic partial repays are expected, always return false
  if (term.maxDelayBetweenPartialRepay == 0) {
    return false;
  }

  // return true if delay is passed
  return loan.lastPartialRepay < Date.now() / 1000 - term.maxDelayBetweenPartialRepay;
}

function checks(termsFilename: string, loansFilename: string) {
  if (!existsSync(termsFilename)) {
    throw new Error('Cannot start LOAN CALLER without terms file. please sync protocol data');
  }
  if (!existsSync(loansFilename)) {
    throw new Error('Cannot start LOAN CALLER without terms file. please sync protocol data');
  }

  if (!process.env.ETH_PRIVATE_KEY) {
    throw new Error('Cannot find ETH_PRIVATE_KEY in env');
  }
}

LoanCaller();
