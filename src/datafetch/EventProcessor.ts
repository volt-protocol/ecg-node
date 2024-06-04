import { EventData, EventQueue } from '../utils/EventQueue';
import { buildTxUrl, sleep } from '../utils/Utils';
import { FetchECGData } from './ECGDataFetcher';
import logger from '../utils/Logger';
import { StartEventListener } from './EventWatcher';

let lastBlockFetched = 0;
export async function StartEventProcessor() {
  logger.debug('Started the event processor');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (EventQueue.length > 0) {
      const event = EventQueue.shift();
      if (event) {
        await ProcessAsync(event);
      }
    } else {
      // logger.debug('EventProcessor: sleeping');
      await sleep(1000);
    }
  }
}

async function ProcessAsync(event: EventData) {
  logger.debug(`NEW EVENT DETECTED AT BLOCK ${event.block}: ${event.eventName}`);
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

    logger.debug(msg);
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
      logger.debug(`GuildToken ${event.eventName} is not important`);
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
      logger.debug(`LendingTerm ${event.eventName} is not important`);
      return false;
    case 'loanopen':
    case 'loanaddcollateral':
    case 'loanpartialrepay':
    case 'loanclose':
    case 'loancall':
    case 'setauctionhouse':
      logger.debug(`LendingTerm ${event.eventName} must force an update`);
      return true;
  }
}

function termFactoryMustUpdate(event: EventData): boolean {
  switch (event.eventName.toLowerCase()) {
    default:
      logger.debug(`TermFactory ${event.eventName} is not important`);
      return false;
    case 'termcreated':
      logger.debug(`TermFactory ${event.eventName} must force an update`);
      return true;
  }
}

function onboardingMustUpdate(event: EventData): boolean {
  switch (event.eventName.toLowerCase()) {
    default:
      logger.debug(`Onboarding ${event.eventName} is not important`);
      return false;
    // case 'proposalexecuted': // dont check proposal executed as it will add a gauge anyway which is already fetched
    case 'proposalcreated':
    case 'proposalqueued':
    case 'proposalcanceled':
      logger.debug(`Onboarding ${event.eventName} must force an update`);
      return true;
  }
}
// StartEventProcessor();
