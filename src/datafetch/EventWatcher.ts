import { ethers, Contract, Interface } from 'ethers';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import { EventQueue } from '../utils/EventQueue';
import './abi/GuildTokenAbi';
import GuildTokenAbi from './abi/GuildTokenAbi';
dotenv.config();

const WSS_URL: string | undefined = process.env.WSS_PROVIDER;
const GUILD_TOKEN_ADDRESS: string | undefined = process.env.GUILD_TOKEN_ADDRESS;

let provider = new ethers.WebSocketProvider(createWebSocket());

function createWebSocket() {
  if (!WSS_URL) {
    throw new Error('No WSS_URL found in env');
  }
  const ws = new WebSocket(WSS_URL);

  ws.on('close', () => {
    console.log('Disconnected. Reconnecting...');
    setTimeout(() => {
      provider = new ethers.WebSocketProvider(createWebSocket());
      StartEventListener();
    }, 1000);
  });

  ws.on('error', (error) => {
    console.log('WebSocket error: ', error);
  });

  return ws;
}

export function StartEventListener() {
  if (!GUILD_TOKEN_ADDRESS) {
    throw new Error('No GUILD_TOKEN_ADDRESS found in env');
  }
  console.log('Started the event listener');
  const guildTokenContract = new Contract(GUILD_TOKEN_ADDRESS, GuildTokenAbi, provider);

  const iface = new Interface(GuildTokenAbi);

  guildTokenContract.removeAllListeners();

  guildTokenContract.on('*', (event) => {
    // The `event.log` has the entire EventLog
    const parsed = iface.parseLog(event.log);

    if (!parsed) {
      console.log('Could not parse event', { event });
      return;
    }

    EventQueue.push({
      txHash: event.log.transactionHash,
      eventName: parsed.name,
      block: event.log.blockNumber,
      originArgs: parsed.args,
      sourceContract: 'GuildToken'
    });
  });
}

// StartEventListener();
