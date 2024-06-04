import { existsSync } from 'node:fs';
import { GetProtocolData, ReadJSON, buildTxUrl, sleep } from '../utils/Utils';
import path from 'path';
import { DATA_DIR } from '../utils/Constants';
import { ethers } from 'ethers';
import LendingTerm, { LendingTermStatus, LendingTermsFileStructure } from '../model/LendingTerm';
import { Loan, LoanStatus, LoansFileStructure } from '../model/Loan';
import { LendingTerm__factory } from '../contracts/types';
import { SendNotifications } from '../utils/Notifications';
import { GetWeb3Provider } from '../utils/Web3Helper';
import { FileMutex } from '../utils/FileMutex';
import logger from '../utils/Logger';
import { LoadConfiguration } from '../config/Config';

const RUN_EVERY_SEC = 15;
const MS_PER_YEAR = 31_557_600_000; // 365.25 days per year

async function LoanCaller() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // load external config
    await LoadConfiguration();
    process.title = 'ECG_NODE_LOAN_CALLER';
    logger.info('starting');
    const termsFilename = path.join(DATA_DIR, 'terms.json');
    const loansFilename = path.join(DATA_DIR, 'loans.json');
    checks(termsFilename, loansFilename);

    // wait for unlock just before reading data file
    await FileMutex.WaitForUnlock();
    const termFileData: LendingTermsFileStructure = ReadJSON(termsFilename);
    const loanFileData: LoansFileStructure = ReadJSON(loansFilename);

    const rpcURL = process.env.RPC_URL;
    if (!rpcURL) {
      throw new Error('Cannot find RPC_URL in env');
    }
    // assume lastBlockTimestampMs is date.now() minus 12 sec
    const lastBlockTimestampMs = Date.now() - 12000;

    const creditMultiplier = GetProtocolData().creditMultiplier;

    const loansToCall: { [termAddress: string]: string[] } = {};

    const loansToCheck = loanFileData.loans.filter((_) => _.status == LoanStatus.ACTIVE);
    logger.debug(`will check ${loansToCheck.length} loans`);
    for (const loan of loansToCheck) {
      const term = termFileData.terms.find((_) => _.termAddress == loan.lendingTermAddress);
      if (!term) {
        throw new Error(`CANNOT FIND TERM ${loan.lendingTermAddress} IN FILE`);
      }

      const termDeprecated = term.status != LendingTermStatus.LIVE;
      const aboveMaxBorrow = checkAboveMaxBorrow(loan, term, creditMultiplier, lastBlockTimestampMs);
      const partialRepayDelayPassed = checkPartialRepayDelayPassed(loan, term);

      if (termDeprecated || aboveMaxBorrow || partialRepayDelayPassed) {
        logger.info(
          `Call needed on Term: ${term.termAddress} / loan ${loan.id} ` +
            `(termDeprecated: ${termDeprecated}, aboveMaxBorrow: ${aboveMaxBorrow}, partialRepayDelayPassed: ${partialRepayDelayPassed})`
        );
        if (!loansToCall[loan.lendingTermAddress]) {
          loansToCall[loan.lendingTermAddress] = [];
        }

        loansToCall[loan.lendingTermAddress].push(loan.id);
      }
    }

    // call if any
    await callMany(loansToCall);
    logger.debug(`sleeping ${RUN_EVERY_SEC} seconds`);
    await sleep(RUN_EVERY_SEC * 1000);
  }
}

async function callMany(loansToCall: { [termAddress: string]: string[] }) {
  if (!process.env.ETH_PRIVATE_KEY) {
    throw new Error('Cannot find ETH_PRIVATE_KEY in env');
  }

  for (const [termAddress, loanIds] of Object.entries(loansToCall)) {
    const web3Provider = GetWeb3Provider();
    const signer = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, web3Provider);
    const lendingTermContract = LendingTerm__factory.connect(termAddress, signer);

    const callManyResponse = await lendingTermContract.callMany(loanIds);

    await callManyResponse.wait();
    // do not send notifications for term 0x427425372b643fc082328b70A0466302179260f5
    // it its the test term used to open loans and calls for external liquidators
    if (termAddress.toLowerCase() != '0x427425372b643fc082328b70A0466302179260f5'.toLowerCase()) {
      await SendNotifications(
        'Loan Caller',
        `called ${loanIds.length} loans on term ${termAddress}`,
        `loanIds:\n ${loanIds.join('\n')}` + `Tx: ${buildTxUrl(callManyResponse.hash)}`
      );
    }
  }
}

function checkAboveMaxBorrow(loan: Loan, term: LendingTerm, creditMultiplier: bigint, lastBlockTimestampMs: number) {
  const maxBorrow = (BigInt(loan.collateralAmount) * BigInt(term.maxDebtPerCollateralToken)) / creditMultiplier;
  const interest =
    (BigInt(loan.borrowAmount) *
      BigInt(term.interestRate) *
      (BigInt(lastBlockTimestampMs) - BigInt(loan.originationTime))) /
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
  return loan.lastPartialRepay + term.maxDelayBetweenPartialRepay * 1000 < Date.now();
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
