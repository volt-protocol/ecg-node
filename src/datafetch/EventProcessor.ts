import { EventData, EventQueue } from '../utils/EventQueue';
import { sleep } from '../utils/Utils';
import { SendTelegramMessage } from '../utils/TelegramHelper';
import { FetchECGData } from './ECGDataFetcher';

const TG_BOT_ID: string | undefined = process.env.TG_BOT_ID;
const TG_CHAT_ID: string | undefined = process.env.TG_CHAT_ID;
const EXPLORER_URI: string | undefined = process.env.EXPLORER_URI;

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
    await FetchECGData();

    const msg =
      `[${event.sourceContract}] Emitted event: ${event.eventName}\n` +
      'Updated backend data\n' +
      `Tx: ${buildTxUrl(event.txHash)}`;
    // send msg if TG bot id and chat id in process.env
    if (TG_BOT_ID && TG_CHAT_ID) {
      await SendTelegramMessage(TG_CHAT_ID, TG_BOT_ID, msg, false);
    } else {
      // else just console log it
      console.log(msg);
    }
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

function buildTxUrl(txhash: string): string {
  return `${EXPLORER_URI}/tx/${txhash}`;
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
      console.log(`LendingTerm ${event.eventName} must force an update`);
      return true;
  }
}
// StartEventProcessor();
