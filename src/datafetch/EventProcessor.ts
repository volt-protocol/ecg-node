import { EventData, EventQueue } from '../utils/EventQueue';
import { buildTxUrl, sleep } from '../utils/Utils';
import { SendTelegramMessage } from '../utils/TelegramHelper';
import { FetchECGData } from './ECGDataFetcher';

let lastBlockFetched = 0;
export async function StartEventProcessor() {
  console.log('Started the event processor');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (EventQueue.length > 0) {
      const event = EventQueue.shift();
      if (event) {
        await ProcessAsync(event);
      }
    } else {
      // console.log('EventProcessor: sleeping');
      await sleep(1000);
    }
  }
}

async function ProcessAsync(event: EventData) {
  console.log(`NEW EVENT DETECTED AT BLOCK ${event.block}: ${event.eventName}`);
  if (mustUpdateProtocol(event)) {
    if (lastBlockFetched < event.block) {
      await FetchECGData();
      lastBlockFetched = event.block;
    }

    const msg =
      `[${event.sourceContract}] Emitted event: ${event.eventName}\n` +
      'Updated backend data\n' +
      `Tx: ${buildTxUrl(event.txHash)}`;

    await SendTelegramMessage(msg, false);
    console.log(msg);
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
  }
}

function guildTokenMustUpdate(event: EventData): boolean {
  switch (event.eventName.toLowerCase()) {
    default:
      console.log(`GuildToken ${event.eventName} is not important`);
      return false;
    case 'addgauge':
    case 'incrementgaugeweight':
      console.log(`GuildToken ${event.eventName} must force an update`);
      return true;
  }
}

function lendingTermMustUpdate(event: EventData): boolean {
  switch (event.eventName.toLowerCase()) {
    default:
      console.log(`LendingTerm ${event.eventName} is not important`);
      return false;
    case 'loanopen':
    case 'loanaddcollateral':
    case 'loanpartialrepay':
    case 'loanclose':
    case 'loancall':
      console.log(`LendingTerm ${event.eventName} must force an update`);
      return true;
  }
}
// StartEventProcessor();
