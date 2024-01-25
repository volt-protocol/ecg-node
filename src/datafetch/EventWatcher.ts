import { ethers, Contract, Interface } from 'ethers';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import { EventQueue } from '../utils/EventQueue';
import GuildTokenAbi from '../contracts/abi/GuildToken.json';
import { GetGuildTokenAddress } from '../config/Config';
dotenv.config();

const WSS_URL: string | undefined = process.env.WSS_PROVIDER;
const RPC_URL: string | undefined = process.env.RPC_URL;

// let provider = new ethers.WebSocketProvider(createWebSocket());
const provider = new ethers.JsonRpcProvider(RPC_URL);

// function createWebSocket() {
//   if (!WSS_URL) {
//     throw new Error('No WSS_URL found in env');
//   }
//   const ws = new WebSocket(WSS_URL);

//   ws.on('close', () => {
//     console.log('Disconnected. Reconnecting...');
//     setTimeout(() => {
//       provider = new ethers.WebSocketProvider(createWebSocket());
//       StartEventListener();
//     }, 1000);
//   });

//   ws.on('error', (error) => {
//     console.log('WebSocket error: ', error);
//   });

//   return ws;
// }

export function StartEventListener() {
  console.log('Started the event listener');
  const guildTokenContract = new Contract(GetGuildTokenAddress(), GuildTokenAbi, provider);

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
