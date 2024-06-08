import { Contract, Interface, JsonRpcProvider } from 'ethers';
import dotenv from 'dotenv';
import { EventQueue } from '../utils/EventQueue';
import GuildTokenAbi from '../contracts/abi/GuildToken.json';
import LendingTermAbi from '../contracts/abi/LendingTerm.json';
import LendingTermFactoryAbi from '../contracts/abi/LendingTermFactory.json';
import LendingTermOnbardingAbi from '../contracts/abi/LendingTermOnboarding.json';
import { GetGuildTokenAddress, GetLendingTermFactoryAddress, GetLendingTermOnboardingAddress } from '../config/Config';
import { GuildToken__factory, LendingTermFactory__factory } from '../contracts/types';
import { GetListenerWeb3Provider } from '../utils/Web3Helper';
import { Log } from '../utils/Logger';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { GetGaugeForMarketId } from '../utils/ECGHelper';
import { DATA_DIR, EXPLORER_URI, MARKET_ID } from '../utils/Constants';
import path from 'path';
import fs from 'fs';
import { GetNodeConfig, ReadJSON } from '../utils/Utils';
import { LendingTermsFileStructure } from '../model/LendingTerm';
import { SendNotificationsList } from '../utils/Notifications';
import { norm } from '../utils/TokenUtils';
dotenv.config();

let guildTokenContract: Contract | undefined = undefined;
let onboardingContract: Contract | undefined = undefined;
let termFactoryContract: Contract | undefined = undefined;
let termsContracts: Contract[] = [];
export function StartEventListener(onlyTerms = false) {
  const provider = GetListenerWeb3Provider(5000);
  Log(`Starting/restarting events listener, onlyTerms: ${onlyTerms}`);
  if (onlyTerms) {
    StartLendingTermListener(provider);
  } else {
    StartGuildTokenListener(provider);
    StartLendingTermListener(provider);
    StartOnboardingListener(provider);
    StartTermFactoryListener(provider);
  }
}

setInterval(() => StartEventListener(false), 30 * 60 * 1000); // restart listener every X minutes

export function StartGuildTokenListener(provider: JsonRpcProvider) {
  if (guildTokenContract) {
    guildTokenContract.removeAllListeners();
  }

  Log('Started the event listener');
  guildTokenContract = new Contract(GetGuildTokenAddress(), GuildTokenAbi, provider);
  Log(`Starting listener on guild token ${GetGuildTokenAddress()}`);
  const guildToken = GuildToken__factory.connect(GetGuildTokenAddress(), provider);

  const iface = new Interface(GuildTokenAbi);

  guildTokenContract.removeAllListeners();

  guildTokenContract.on('*', (event) => {
    // The `event.log` has the entire EventLog
    const parsed = iface.parseLog(event.log);

    if (!parsed) {
      Log('Could not parse event', { event });
      return;
    }

    if (parsed.name.toLowerCase() == 'addgauge') {
      if (parsed.args.gaugeType && Number(parsed.args.gaugeType as bigint) != MARKET_ID) {
        Log(`Event ${parsed.name} not on marketId ${MARKET_ID}, ignoring`);
        return;
      }
    }

    if (['removegauge', 'incrementgaugeweight', 'decrementgaugeweight'].includes(parsed.name.toLowerCase())) {
      const gaugeAddress = parsed.args.gauge;
      guildToken.gaugeType(gaugeAddress).then((gaugeType: bigint) => {
        if (Number(gaugeType) == MARKET_ID) {
          EventQueue.push({
            txHash: event.log.transactionHash,
            eventName: parsed.name,
            block: event.log.blockNumber,
            originArgs: parsed.args,
            sourceContract: 'GuildToken',
            originArgName: parsed.fragment.inputs.map((_) => _.name)
          });

          // if remove gauge, send notification
          if ('removegauge' == parsed.name.toLowerCase()) {
            // find the term in terms
            const termsFileName = path.join(DATA_DIR, 'terms.json');
            if (!fs.existsSync(termsFileName)) {
              throw new Error(`Could not find file ${termsFileName}`);
            }
            const termsFile: LendingTermsFileStructure = ReadJSON(termsFileName);
            const foundTerm = termsFile.terms.find((_) => _.termAddress == gaugeAddress);
            if (foundTerm) {
              if (GetNodeConfig().processors.TERM_ONBOARDING_WATCHER.enabled) {
                SendNotificationsList(
                  'TermOffboardingWatcher',
                  `Term ${foundTerm.label} offboarded`,
                  [
                    {
                      fieldName: 'Term address',
                      fieldValue: `${EXPLORER_URI}/address/${foundTerm.termAddress}`
                    },
                    {
                      fieldName: 'Collateral',
                      fieldValue: foundTerm.collateralSymbol
                    },
                    {
                      fieldName: 'Hard Cap',
                      fieldValue: foundTerm.hardCap
                    },
                    {
                      fieldName: 'Interest rate',
                      fieldValue: norm(foundTerm.interestRate).toString()
                    },
                    {
                      fieldName: 'maxDebtPerCollateralToken',
                      fieldValue: foundTerm.maxDebtPerCollateralToken
                    }
                  ],
                  true
                );
              }
            }
          }
        } else {
          Log(`Event ${parsed.name} not on marketId ${MARKET_ID}, ignoring`);
        }
      });
    } else {
      EventQueue.push({
        txHash: event.log.transactionHash,
        eventName: parsed.name,
        block: event.log.blockNumber,
        originArgs: parsed.args,
        sourceContract: 'GuildToken',
        originArgName: parsed.fragment.inputs.map((_) => _.name)
      });
    }
  });
}

export function StartOnboardingListener(provider: JsonRpcProvider) {
  if (onboardingContract) {
    onboardingContract.removeAllListeners();
  }

  Log('Started the event listener');
  onboardingContract = new Contract(GetLendingTermOnboardingAddress(), LendingTermOnbardingAbi, provider);
  Log(`Starting listener on onboarding ${GetLendingTermOnboardingAddress()}`);

  onboardingContract.removeAllListeners();

  onboardingContract.on('*', (event) => {
    // The `event.log` has the entire EventLog
    const parsed = onboardingContract?.interface.parseLog(event.log);

    if (!parsed) {
      Log('Could not parse event', { event });
      return;
    }

    EventQueue.push({
      txHash: event.log.transactionHash,
      eventName: parsed.name,
      block: event.log.blockNumber,
      originArgs: parsed.args,
      sourceContract: 'Onboarding',
      originArgName: parsed.fragment.inputs.map((_) => _.name)
    });
  });
}

export function StartTermFactoryListener(provider: JsonRpcProvider) {
  if (termFactoryContract) {
    termFactoryContract.removeAllListeners();
  }

  Log('Started the event listener');
  termFactoryContract = new Contract(GetLendingTermFactoryAddress(), LendingTermFactoryAbi, provider);
  Log(`Starting listener on term factory ${GetLendingTermFactoryAddress()}`);
  const termFactory = LendingTermFactory__factory.connect(GetLendingTermFactoryAddress(), provider);

  termFactoryContract.removeAllListeners();

  // only listen to term created for the current node market
  const filter = termFactory.filters.TermCreated(undefined, MARKET_ID, undefined, undefined);

  termFactoryContract.on(filter, (event) => {
    // The `event.log` has the entire EventLog
    const parsed = termFactoryContract?.interface.parseLog(event.log);

    if (!parsed) {
      Log('Could not parse event', { event });
      return;
    }

    EventQueue.push({
      txHash: event.log.transactionHash,
      eventName: parsed.name,
      block: event.log.blockNumber,
      originArgs: parsed.args,
      sourceContract: 'TermFactory',
      originArgName: parsed.fragment.inputs.map((_) => _.name)
    });
  });
}

export function StartLendingTermListener(provider: JsonRpcProvider) {
  // cleanup all listeners
  for (const termContract of termsContracts) {
    termContract.removeAllListeners();
  }
  termsContracts = [];
  Log('Started the event listener');
  const termsFileName = path.join(DATA_DIR, 'terms.json');
  if (!fs.existsSync(termsFileName)) {
    throw new Error(`Could not find file ${termsFileName}`);
  }
  const termsFile: LendingTermsFileStructure = ReadJSON(termsFileName);
  const termsWithDebtCeiling = termsFile.terms.filter((_) => _.debtCeiling != '0');
  Log(`Starting terms listener for ${termsWithDebtCeiling.length}/${termsFile.terms.length} terms`);
  // get all lending terms (gauges) from the guild token to start a listener on each one

  for (const lendingTermAddress of termsWithDebtCeiling.map((_) => _.termAddress)) {
    const termContract = new Contract(lendingTermAddress, LendingTermAbi, provider);
    termsContracts.push(termContract);
    Log(`Starting listener on term ${lendingTermAddress}`);
    const iface = new Interface(LendingTermAbi);

    termContract.removeAllListeners();

    termContract.on('*', (event) => {
      // The `event.log` has the entire EventLog
      const parsed = iface.parseLog(event.log);

      if (!parsed) {
        Log('Could not parse event', { event });
        return;
      }

      EventQueue.push({
        txHash: event.log.transactionHash,
        eventName: parsed.name,
        block: event.log.blockNumber,
        originArgs: parsed.args,
        sourceContract: 'LendingTerm',
        originArgName: parsed.fragment.inputs.map((_) => _.name)
      });
    });
  }
}

// StartEventListener();
