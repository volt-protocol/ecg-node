import { JsonRpcProvider, ethers } from 'ethers';
import dotenv from 'dotenv';
import {
  GetGuildTokenAddress,
  GetLendingTermFactoryAddress,
  GetLendingTermOffboardingAddress,
  GetLendingTermOnboardingAddress
} from '../config/Config';
import { GetListenerWeb3Provider } from '../utils/Web3Helper';
import path from 'path';
import fs from 'fs';
import { LendingTermsFileStructure } from '../model/LendingTerm';
import { DATA_DIR } from '../utils/Constants';
import { ReadJSON, sleep } from '../utils/Utils';
import { Log } from '../utils/Logger';
import { EventQueueV2, SourceContractEnum } from '../utils/EventQueue';
import { LoanStatus, LoansFileStructure } from '../model/Loan';
dotenv.config();

const WAIT_TIME_MS = 30 * 60 * 1000;
let provider: JsonRpcProvider | undefined = undefined;
let shouldRestartNow = false;

export function RestartUniversalEventListener() {
  shouldRestartNow = true;
}

export async function StartUniversalEventListener() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    Log('Starting universal event listener');
    shouldRestartNow = false;
    if (provider) {
      Log('Removing listeners');
      provider.removeAllListeners();
    }
    provider = GetListenerWeb3Provider(10000);
    const guildTokenAddress = await GetGuildTokenAddress();
    const lendingTermOnboardingAddress = await GetLendingTermOnboardingAddress();
    const lendingTermOffboardingAddress = await GetLendingTermOffboardingAddress();
    const lendingTermFactoryAddress = await GetLendingTermFactoryAddress();

    const termsFileName = path.join(DATA_DIR, 'terms.json');
    const loansFileName = path.join(DATA_DIR, 'loans.json');
    if (!fs.existsSync(termsFileName)) {
      throw new Error(`Could not find file ${termsFileName}`);
    }
    if (!fs.existsSync(loansFileName)) {
      throw new Error(`Could not find file ${loansFileName}`);
    }
    const termsFile: LendingTermsFileStructure = ReadJSON(termsFileName);
    const loansFile: LoansFileStructure = ReadJSON(loansFileName);
    const termsWithDebtCeiling = termsFile.terms.filter((_) => _.debtCeiling != '0').map((_) => _.termAddress);
    const termsWithNonClosedLoans = Array.from(
      new Set<string>(loansFile.loans.filter((_) => _.status != LoanStatus.CLOSED).map((_) => _.lendingTermAddress))
    );
    for (const termWithNonClosedLoans of termsWithNonClosedLoans) {
      if (!termsWithDebtCeiling.includes(termWithNonClosedLoans)) {
        termsWithDebtCeiling.push(termWithNonClosedLoans);
      }
    }
    Log(`Starting terms listener for ${termsWithDebtCeiling.length}/${termsFile.terms.length} terms`);

    const addresses: string[] = [];
    addresses.push(guildTokenAddress);
    addresses.push(lendingTermOnboardingAddress);
    addresses.push(lendingTermOffboardingAddress);
    addresses.push(lendingTermFactoryAddress);
    addresses.push(...termsWithDebtCeiling);
    provider.on(
      {
        address: addresses
      },
      (event: ethers.Log) => {
        Log(`Receive event from address ${event.address}`);

        let sourceContract: SourceContractEnum = SourceContractEnum.UNK;
        if (event.address == guildTokenAddress) {
          Log('new event from GUILD');
          sourceContract = SourceContractEnum.GUILD;
        } else if (event.address == lendingTermOnboardingAddress) {
          Log('new event from LENDING TERM ONBOARDING');
          sourceContract = SourceContractEnum.TERM_ONBOARDING;
        } else if (event.address == lendingTermOffboardingAddress) {
          Log('new event from LENDING TERM OFFBOARDING');
          sourceContract = SourceContractEnum.TERM_OFFBOARDING;
        } else if (event.address == lendingTermFactoryAddress) {
          Log('new event from LENDING TERM FACTORY');
          sourceContract = SourceContractEnum.TERM_FACTORY;
        } else if (termsWithDebtCeiling.includes(event.address)) {
          Log(`new event from TERM (${event.address}}`);
          sourceContract = SourceContractEnum.TERM;
        }

        // add all events received on these contracts, the filter will be done later
        EventQueueV2.push({
          block: event.blockNumber,
          log: event,
          sourceAddress: event.address,
          sourceContract: sourceContract,
          txHash: event.transactionHash
        });
      }
    );

    const restartDate = Date.now() + WAIT_TIME_MS;
    while (!shouldRestartNow && Date.now() < restartDate) {
      await sleep(500);
    }

    if (shouldRestartNow) {
      Log('Force restarting event listener');
    } else {
      Log(`Restarting event listener because ${WAIT_TIME_MS / (60 * 1000)} minutes passed since last restart`);
    }
  }
}

// StartUniversalEventListener();
