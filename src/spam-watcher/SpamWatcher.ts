import { Contract, Interface, JsonRpcProvider } from 'ethers';
import dotenv from 'dotenv';
import GuildTokenAbi from '../contracts/abi/GuildToken.json';
import LendingTermAbi from '../contracts/abi/LendingTerm.json';
import PSMAbi from '../contracts/abi/SimplePSM.json';
import { GuildToken__factory, LendingTerm__factory } from '../contracts/types';
import { GetListenerWeb3Provider, GetWeb3Provider } from '../utils/Web3Helper';
import { Log, Warn } from '../utils/Logger';
import { EventData } from '../utils/EventQueue';
import { SendNotificationsSpam } from '../utils/Notifications';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { buildTxUrl } from '../utils/Utils';
dotenv.config();

const GUILD_TOKEN_ADDRESS = '0xb8ae64F191F829fC00A4E923D460a8F2E0ba3978';
const PSM_ADDRESSES = [
  { token: 'WETH-test', address: '0x81869fcBF98ab8982B5c30529A2E7C3C24f7554e' },
  { token: 'USDC-test', address: '0x47fa48413508b979Ca72Fe638011Ecf0556429bE' },
  { token: 'USDC', address: '0xc273c03D7F28f570C6765Be50322BC06bdd4bFab' },
  { token: 'WETH', address: '0x475840078280BaE8EF2428dbe151c7b349CF3f50' },
  { token: 'ARB', address: '0x4dC22679436e4C751bdfe6c518CD7768E999CED3' }
];

let guildTokenContract: Contract | undefined = undefined;
let psmContracts: Contract[] = [];
let termsContracts: Contract[] = [];
export function StartSpamEventListener() {
  const provider = GetListenerWeb3Provider(5000);
  Log('Starting/restarting spam listener');
  StartGuildTokenListener(provider);
  StartLendingTermListener(provider);
  StartPSMListener(provider);
}

setInterval(() => StartSpamEventListener(), 30 * 60 * 1000); // restart listener every X minutes

export function StartGuildTokenListener(provider: JsonRpcProvider) {
  if (guildTokenContract) {
    guildTokenContract.removeAllListeners();
  }

  Log('Started the event listener');
  guildTokenContract = new Contract(GUILD_TOKEN_ADDRESS, GuildTokenAbi, provider);
  Log(`Starting listener on guild token ${GUILD_TOKEN_ADDRESS}`);

  const iface = new Interface(GuildTokenAbi);

  guildTokenContract.removeAllListeners();

  guildTokenContract.on('*', (event) => {
    // The `event.log` has the entire EventLog
    const parsed = iface.parseLog(event.log);

    if (!parsed) {
      Log('Could not parse event', { event });
      return;
    }

    if (
      ['addgauge', 'removegauge', 'incrementgaugeweight', 'decrementgaugeweight'].includes(parsed.name.toLowerCase())
    ) {
      const evenData: EventData = {
        txHash: event.log.transactionHash,
        eventName: parsed.name,
        block: event.log.blockNumber,
        originArgs: parsed.args,
        sourceContract: 'GuildToken',
        originArgName: parsed.fragment.inputs.map((_) => _.name)
      };

      SendSpamNotif(evenData);
    }
  });
}

export function StartLendingTermListener(provider: JsonRpcProvider) {
  // cleanup all listeners
  for (const termContract of termsContracts) {
    termContract.removeAllListeners();
  }
  termsContracts = [];

  // get all lives terms
  const guildTokenContract = GuildToken__factory.connect(GUILD_TOKEN_ADDRESS, provider);
  guildTokenContract.liveGauges().then((liveTerms) => {
    Log(`Liveterms: ${liveTerms.length}`);
    // find all gauges with debt ceiling
    const multicallProvider = MulticallWrapper.wrap(GetWeb3Provider());
    Promise.all(
      liveTerms.map((_) => {
        const termContract = LendingTerm__factory.connect(_, multicallProvider);
        return termContract['debtCeiling()']();
      })
    ).then((debtCeilingResult) => {
      const termsWithDebtCeiling: string[] = [];
      for (let i = 0; i < liveTerms.length; i++) {
        const termAddress = liveTerms[i];
        const debtCeiling = debtCeilingResult[i];
        if (debtCeiling > 0n) {
          termsWithDebtCeiling.push(termAddress);
        }
      }

      Log(`Starting terms listener for ${termsWithDebtCeiling.length}/${liveTerms.length} terms`);
      for (const lendingTermAddress of termsWithDebtCeiling) {
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

          if (['loanopen', 'loanpartialrepay', 'loanclose', 'loancall'].includes(parsed.name.toLowerCase())) {
            const evenData: EventData = {
              txHash: event.log.transactionHash,
              eventName: parsed.name,
              block: event.log.blockNumber,
              originArgs: parsed.args,
              sourceContract: 'LendingTerm',
              originArgName: parsed.fragment.inputs.map((_) => _.name)
            };

            SendSpamNotif(evenData);
          }
        });
      }
    });
  });
}

export function StartPSMListener(provider: JsonRpcProvider) {
  // cleanup all listeners
  for (const psmContract of psmContracts) {
    psmContract.removeAllListeners();
  }
  psmContracts = [];

  for (const psm of PSM_ADDRESSES) {
    const psmContract = new Contract(psm.address, PSMAbi, provider);
    psmContracts.push(psmContract);
    Log(`Starting listener on psm ${psm.address}`);
    const iface = new Interface(PSMAbi);

    psmContract.removeAllListeners();

    psmContract.on('*', (event) => {
      // The `event.log` has the entire EventLog
      const parsed = iface.parseLog(event.log);

      if (!parsed) {
        Log('Could not parse event', { event });
        return;
      }

      if (['mint', 'redeem'].includes(parsed.name.toLowerCase())) {
        const evenData: EventData = {
          txHash: event.log.transactionHash,
          eventName: parsed.name,
          block: event.log.blockNumber,
          originArgs: parsed.args,
          sourceContract: `PSM ${psm.token}`,
          originArgName: parsed.fragment.inputs.map((_) => _.name)
        };

        SendSpamNotif(evenData);
      }
    });
  }
}

async function SendSpamNotif(event: EventData) {
  try {
    const fields: { fieldName: string; fieldValue: string }[] = [];
    fields.push({
      fieldName: 'Source',
      fieldValue: event.sourceContract
    });
    fields.push({
      fieldName: 'Block',
      fieldValue: event.block.toString()
    });
    fields.push({
      fieldName: 'Tx',
      fieldValue: buildTxUrl(event.txHash)
    });

    for (let i = 0; i < event.originArgName.length; i++) {
      const argName = event.originArgName[i];
      const argVal = event.originArgs[i];

      fields.push({
        fieldName: argName,
        fieldValue: argVal.toString()
      });
    }
    await SendNotificationsSpam('Spam Event Sender', `NEW ${event.eventName.toUpperCase()} RECEIVED`, fields);
  } catch (e) {
    Warn('Error sending notification to spam', e);
  }
}

StartSpamEventListener();
