import { ethers, Contract, Interface } from 'ethers';
import dotenv from 'dotenv';
import { EventQueue } from '../utils/EventQueue';
import GuildTokenAbi from '../contracts/abi/GuildToken.json';
import LendingTermAbi from '../contracts/abi/LendingTerm.json';
import { GetGuildTokenAddress } from '../config/Config';
import { GuildToken__factory } from '../contracts/types';
import { GetWeb3Provider } from '../utils/Web3Helper';
import { Log } from '../utils/Logger';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { GetGaugeForMarketId } from '../utils/ECGHelper';
import { MARKET_ID } from '../utils/Constants';
dotenv.config();

const provider = GetWeb3Provider(15000);

let guildTokenContract: Contract | undefined = undefined;
let termsContracts: Contract[] = [];
export function StartEventListener() {
  Log('Starting/restarting events listener');
  StartGuildTokenListener();
  StartLendingTermListener();
}

setInterval(StartEventListener, 30 * 60 * 1000); // restart listener every X minutes

export function StartGuildTokenListener() {
  if (guildTokenContract) {
    guildTokenContract.removeAllListeners();
  }

  Log('Started the event listener');
  guildTokenContract = new Contract(GetGuildTokenAddress(), GuildTokenAbi, provider);
  Log(`Starting listener on guild token ${GetGuildTokenAddress()}`);

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
      StartLendingTermListener();
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

export function StartLendingTermListener() {
  // cleanup all listeners
  for (const termContract of termsContracts) {
    termContract.removeAllListeners();
  }
  termsContracts = [];
  Log('Started the event listener');
  const guildTokenContract = GuildToken__factory.connect(GetGuildTokenAddress(), MulticallWrapper.wrap(provider));

  // get all lending terms (gauges) from the guild token to start a listener on each one
  GetGaugeForMarketId(guildTokenContract, MARKET_ID, true).then((terms) => {
    for (const lendingTermAddress of terms) {
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
          sourceContract: 'LendingTerm'
        });
      });
    }
  });
}

// StartEventListener();
