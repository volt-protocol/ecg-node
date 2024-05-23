import { EventData, EventQueue } from '../utils/EventQueue';
import { buildTxUrl, sleep } from '../utils/Utils';
import { FetchECGData } from './ECGDataFetcher';
import { SendNotifications, SendNotificationsSpam } from '../utils/Notifications';
import { Log, Warn } from '../utils/Logger';
import { StartEventListener } from './EventWatcher';
import { MARKET_ID } from '../utils/Constants';
import { GuildToken__factory, LendingTerm__factory } from '../contracts/types';
import { GetWeb3Provider } from '../utils/Web3Helper';
import { GetGuildTokenAddress } from '../config/Config';

let lastBlockFetched = 0;
export async function StartEventProcessor() {
  Log('Started the event processor');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (EventQueue.length > 0) {
      const event = EventQueue.shift();
      if (event) {
        await ProcessAsync(event);
      }
    } else {
      // Log('EventProcessor: sleeping');
      await sleep(1000);
    }
  }
}

async function ProcessAsync(event: EventData) {
  Log(`NEW EVENT DETECTED AT BLOCK ${event.block}: ${event.eventName}`);
  if (mustUpdateProtocol(event)) {
    if (lastBlockFetched < event.block) {
      await FetchECGData();
      lastBlockFetched = event.block;

      const restartListenerEvents = ['incrementgaugeweight', 'addgauge', 'decrementgaugeweight'];
      if (restartListenerEvents.includes(event.eventName.toLowerCase())) {
        StartEventListener(true);
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
function mustUpdateProtocol(event: EventData): boolean {
  switch (event.sourceContract.toLowerCase()) {
    default:
      throw new Error(`Unknown contract: ${event.sourceContract}`);
    case 'guildtoken':
      return guildTokenMustUpdate(event);
    case 'lendingterm':
      return lendingTermMustUpdate(event);
    case 'termfactory':
      return termFactoryMustUpdate(event);
    case 'onboarding':
      return onboardingMustUpdate(event);
  }
}

function guildTokenMustUpdate(event: EventData): boolean {
  switch (event.eventName.toLowerCase()) {
    default:
      Log(`GuildToken ${event.eventName} is not important`);
      return false;
    case 'addgauge':
    case 'removegauge':
    case 'incrementgaugeweight':
    case 'decrementgaugeweight':
      return true;
  }
}

function lendingTermMustUpdate(event: EventData): boolean {
  switch (event.eventName.toLowerCase()) {
    default:
      Log(`LendingTerm ${event.eventName} is not important`);
      return false;
    case 'loanopen':
    case 'loanaddcollateral':
    case 'loanpartialrepay':
    case 'loanclose':
    case 'loancall':
    case 'setauctionhouse':
      Log(`LendingTerm ${event.eventName} must force an update`);
      return true;
  }
}

function termFactoryMustUpdate(event: EventData): boolean {
  switch (event.eventName.toLowerCase()) {
    default:
      Log(`TermFactory ${event.eventName} is not important`);
      return false;
    case 'termcreated':
      Log(`TermFactory ${event.eventName} must force an update`);
      return true;
  }
}

function onboardingMustUpdate(event: EventData): boolean {
  switch (event.eventName.toLowerCase()) {
    default:
      Log(`Onboarding ${event.eventName} is not important`);
      return false;
    // case 'proposalexecuted': // dont check proposal executed as it will add a gauge anyway which is already fetched
    case 'proposalcreated':
    case 'proposalqueued':
    case 'proposalcanceled':
      Log(`Onboarding ${event.eventName} must force an update`);
      return true;
  }
}
// StartEventProcessor();
