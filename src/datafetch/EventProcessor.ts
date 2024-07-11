import { EventDataV2, EventQueueV2, SourceContractEnum } from '../utils/EventQueue';
import { ReadJSON, buildTxUrl, sleep } from '../utils/Utils';
import { FetchECGData } from './ECGDataFetcher';
import { SendNotificationsList } from '../utils/Notifications';
import { Log, Warn } from '../utils/Logger';
import { DATA_DIR, EXPLORER_URI, MARKET_ID, TERM_ONBOARDING_WATCHER_ENABLED } from '../utils/Constants';
import {
  GuildToken__factory,
  LendingTermFactory__factory,
  LendingTermOffboarding__factory,
  LendingTermOnboarding__factory,
  LendingTerm__factory
} from '../contracts/types';
import { GetNodeConfig } from '../config/Config';
import { RestartUniversalEventListener } from './EventWatcher';
import path from 'path';
import fs from 'fs';
import { LendingTermsFileStructure } from '../model/LendingTerm';
import { norm } from '../utils/TokenUtils';
import { GetTermMarketId } from '../utils/ECGHelper';

let lastBlockFetched = 0;
export async function StartEventProcessor() {
  Log('Started the event processor');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (EventQueueV2.length > 0) {
      const event = EventQueueV2.shift();
      if (event) {
        await ProcessAsync(event);
      }
    } else {
      // Log('EventProcessor: sleeping');
      await sleep(1000);
    }
  }
}

async function ProcessAsync(event: EventDataV2) {
  const { mustUpdateProtocolData, mustRestartListeners } = await mustUpdateProtocol(event);
  if (mustUpdateProtocolData) {
    if (lastBlockFetched < event.block) {
      await FetchECGData();
      lastBlockFetched = event.block;

      if (mustRestartListeners) {
        RestartUniversalEventListener();
      }
    }

    const msg = 'Updated backend data\n' + `Tx: ${buildTxUrl(event.txHash)}`;

    Log(msg);
  }
}

/**
 * Check whether an event should start a protocol data refetch
 * @param event
 * @returns
 */
async function mustUpdateProtocol(event: EventDataV2): Promise<{
  mustUpdateProtocolData: boolean;
  mustRestartListeners: boolean;
}> {
  switch (event.sourceContract) {
    default:
      Log(`NEW EVENT DETECTED AT BLOCK ${event.block} from contract ${event.sourceContract}`);
      throw new Error(`Unknown contract: ${event.sourceContract}`);
    case SourceContractEnum.GUILD:
      return await guildTokenMustUpdate(event);
    case SourceContractEnum.TERM:
      return await lendingTermMustUpdate(event);
    case SourceContractEnum.TERM_FACTORY:
      return await termFactoryMustUpdate(event);
    case SourceContractEnum.TERM_ONBOARDING:
      return await onboardingMustUpdate(event);
    case SourceContractEnum.TERM_OFFBOARDING:
      return await offboardingMustUpdate(event);
  }
}

async function guildTokenMustUpdate(event: EventDataV2): Promise<{
  mustUpdateProtocolData: boolean;
  mustRestartListeners: boolean;
}> {
  const iface = GuildToken__factory.createInterface();
  const parsed = iface.parseLog({ topics: event.log.topics as string[], data: event.log.data });
  if (!parsed) {
    Warn('Cannot parse event', event);
    return { mustUpdateProtocolData: false, mustRestartListeners: false };
  }

  Log(`NEW EVENT DETECTED AT BLOCK ${event.block} from contract ${event.sourceContract}: ${parsed.name}`);
  switch (parsed.name.toLowerCase()) {
    default:
      Log(`GuildToken ${parsed.name} is not important`);
      return { mustUpdateProtocolData: false, mustRestartListeners: false };
    case 'addgauge':
      if (parsed.args.gaugeType && Number(parsed.args.gaugeType as bigint) != MARKET_ID) {
        Log(`Event ${parsed.name} not on marketId ${MARKET_ID}, ignoring`);
        return { mustUpdateProtocolData: false, mustRestartListeners: false };
      } else {
        return { mustUpdateProtocolData: true, mustRestartListeners: true };
      }
    case 'removegauge':
    case 'incrementgaugeweight':
    case 'decrementgaugeweight': {
      // check if the event was about the good gaugeType (marketId)
      if ((await GetTermMarketId(parsed.args.gauge)) == MARKET_ID) {
        if (parsed.name.toLowerCase() == 'removegauge' && TERM_ONBOARDING_WATCHER_ENABLED) {
          await SendOffboardingNotification(parsed.args.gauge);
        }

        // on valid market id, return true
        return { mustUpdateProtocolData: true, mustRestartListeners: true };
      } else {
        Log(`Event ${parsed.name} not on marketId ${MARKET_ID}, ignoring`);
        // not on the good market; return false
        return { mustUpdateProtocolData: false, mustRestartListeners: false };
      }
    }
  }
}

function lendingTermMustUpdate(event: EventDataV2): {
  mustUpdateProtocolData: boolean;
  mustRestartListeners: boolean;
} {
  const iface = LendingTerm__factory.createInterface();
  const parsed = iface.parseLog({ topics: event.log.topics as string[], data: event.log.data });
  if (!parsed) {
    Warn('Cannot parse event', event);
    return { mustUpdateProtocolData: false, mustRestartListeners: false };
  }

  Log(`NEW EVENT DETECTED AT BLOCK ${event.block} from contract ${event.sourceContract}: ${parsed.name}`);
  switch (parsed.name.toLowerCase()) {
    default:
      Log(`LendingTerm ${parsed.name} is not important`);
      return { mustUpdateProtocolData: false, mustRestartListeners: false };
    case 'loanopen':
    case 'loanaddcollateral':
    case 'loanpartialrepay':
    case 'loanclose':
    case 'loancall':
    case 'setauctionhouse':
      Log(`LendingTerm ${parsed.name} must force an update`);
      return { mustUpdateProtocolData: true, mustRestartListeners: false };
  }
}

function termFactoryMustUpdate(event: EventDataV2): {
  mustUpdateProtocolData: boolean;
  mustRestartListeners: boolean;
} {
  const iface = LendingTermFactory__factory.createInterface();
  const parsed = iface.parseLog({ topics: event.log.topics as string[], data: event.log.data });
  if (!parsed) {
    Warn('Cannot parse event', event);
    return { mustUpdateProtocolData: false, mustRestartListeners: false };
  }
  Log(`NEW EVENT DETECTED AT BLOCK ${event.block} from contract ${event.sourceContract}: ${parsed.name}`);
  switch (parsed.name.toLowerCase()) {
    default:
      Log(`TermFactory ${parsed.name} is not important`);
      return { mustUpdateProtocolData: false, mustRestartListeners: false };
    case 'termcreated':
      Log(`TermFactory ${parsed.name} must force an update`);
      return { mustUpdateProtocolData: true, mustRestartListeners: false };
  }
}

function onboardingMustUpdate(event: EventDataV2): {
  mustUpdateProtocolData: boolean;
  mustRestartListeners: boolean;
} {
  const iface = LendingTermOnboarding__factory.createInterface();
  const parsed = iface.parseLog({ topics: event.log.topics as string[], data: event.log.data });
  if (!parsed) {
    Warn('Cannot parse event', event);
    return { mustUpdateProtocolData: false, mustRestartListeners: false };
  }

  Log(`NEW EVENT DETECTED AT BLOCK ${event.block} from contract ${event.sourceContract}: ${parsed.name}`);
  switch (parsed.name.toLowerCase()) {
    default:
      Log(`Onboarding ${parsed.name} is not important`);
      return { mustUpdateProtocolData: false, mustRestartListeners: false };
    // case 'proposalexecuted': // dont check proposal executed as it will add a gauge anyway which is already fetched
    case 'proposalcreated':
    case 'proposalqueued':
    case 'proposalcanceled':
      Log(`Onboarding ${parsed.name} must force an update`);
      return { mustUpdateProtocolData: true, mustRestartListeners: false };
  }
}

async function offboardingMustUpdate(event: EventDataV2): Promise<{
  mustUpdateProtocolData: boolean;
  mustRestartListeners: boolean;
}> {
  const iface = LendingTermOffboarding__factory.createInterface();
  const parsed = iface.parseLog({ topics: event.log.topics as string[], data: event.log.data });
  if (!parsed) {
    Warn('Cannot parse event', event);
    return { mustUpdateProtocolData: false, mustRestartListeners: false };
  }

  Log(`NEW EVENT DETECTED AT BLOCK ${event.block} from contract ${event.sourceContract}: ${parsed.name}`);
  switch (parsed.name.toLowerCase()) {
    default:
      Log(`Offboarding ${parsed.name} is not important`);
      return { mustUpdateProtocolData: false, mustRestartListeners: false };
    case 'cleanup':
      if ((await GetTermMarketId(parsed.args.term)) == MARKET_ID) {
        Log(`Offboarding ${parsed.name} must force an update`);
        return { mustUpdateProtocolData: true, mustRestartListeners: false };
      } else {
        Log(`Offboarding ${parsed.name} is on a term not on marketId ${MARKET_ID}, ignoring`);
        return { mustUpdateProtocolData: false, mustRestartListeners: false };
      }
  }
}

async function SendOffboardingNotification(gaugeAddress: string) {
  // find the term in terms
  const termsFileName = path.join(DATA_DIR, 'terms.json');
  if (!fs.existsSync(termsFileName)) {
    throw new Error(`Could not find file ${termsFileName}`);
  }
  const termsFile: LendingTermsFileStructure = ReadJSON(termsFileName);
  const foundTerm = termsFile.terms.find((_) => _.termAddress == gaugeAddress);
  if (foundTerm) {
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

// StartEventProcessor();
