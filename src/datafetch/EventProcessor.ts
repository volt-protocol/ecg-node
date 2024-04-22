import { EventData, EventQueue } from '../utils/EventQueue';
import { buildTxUrl, sleep } from '../utils/Utils';
import { FetchECGData } from './ECGDataFetcher';
import { SendNotifications } from '../utils/Notifications';
import { Log } from '../utils/Logger';
import { StartEventListener } from './EventWatcher';

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

    // await SendNotifications(event.sourceContract, `Emitted event: ${event.eventName}`, msg);
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
      Log(`GuildToken ${event.eventName} must force an update`);
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
    case 'proposalcreated':
    case 'proposalexecuted':
    case 'proposalqueued':
    case 'proposalcanceled':
      Log(`Onboarding ${event.eventName} must force an update`);
      return true;
  }
}
// StartEventProcessor();
