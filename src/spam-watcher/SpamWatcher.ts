import { Contract, Interface, JsonRpcProvider } from 'ethers';
import dotenv from 'dotenv';
import GuildTokenAbi from '../contracts/abi/GuildToken.json';
import LendingTermAbi from '../contracts/abi/LendingTerm.json';
import PSMAbi from '../contracts/abi/SimplePSM.json';
import { GuildToken__factory, LendingTerm__factory } from '../contracts/types';
import { GetListenerWeb3Provider } from '../utils/Web3Helper';
import { Log, Warn } from '../utils/Logger';
import { EventData } from '../utils/EventQueue';
import { SendNotificationsSpam } from '../utils/Notifications';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { buildTxUrl } from '../utils/Utils';
import { HttpGet } from '../utils/HttpHelper';
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
        sourceAddress: event.log.address,
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
    const multicallProvider = MulticallWrapper.wrap(GetListenerWeb3Provider(5000));
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
              sourceAddress: event.log.address,
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
          sourceAddress: event.log.address,
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
      fieldName: 'Tx',
      fieldValue: buildTxUrl(event.txHash)
    });
    fields.push({
      fieldName: 'Source',
      fieldValue: event.sourceContract + (event.sourceAddress ? (' @ ' + event.sourceAddress) : '')
    });

    for (let i = 0; i < event.originArgName.length; i++) {
      const argName = event.originArgName[i];
      const argVal = event.originArgs[i];

      fields.push({
        fieldName: argName,
        fieldValue: argVal.toString()
      });
    }
    const formattedNotif = await formatNotif(event, fields);
    await SendNotificationsSpam(formattedNotif.title, formattedNotif.text, formattedNotif.fields);
  } catch (e) {
    Warn('Error sending notification to spam', e);
  }
}

async function formatNotif(event: EventData, fields: { fieldName: string; fieldValue: string }[]) : Promise<{
  title: string;
  text: string;
  fields: { fieldName: string; fieldValue: string }[]
}> {
  const contractJsonFile = await HttpGet<{
    addr: string;
    name: string;
  }[]>('https://raw.githubusercontent.com/volt-protocol/ethereum-credit-guild/main/protocol-configuration/addresses.arbitrum.json');
  
  let sourceAddressLabel = 'UNKNOWN_ADDRESS';
  if (event.sourceAddress) {
    sourceAddressLabel = contractJsonFile.find((_)=>_.addr.toLowerCase() == event.sourceAddress?.toLowerCase())?.name || sourceAddressLabel;
  }
  const ret = {
    title: `${event.eventName}`,
    text: [
      sourceAddressLabel == 'UNKNOWN_ADDRESS' ? (fields.find((_)=>_.fieldName == 'Source')?.fieldValue || '') : sourceAddressLabel,
      '\n',
      fields.find((_)=>_.fieldName == 'Tx')?.fieldValue || ''
    ].join(''),
    fields: fields.filter((_) => !['Tx', 'Source'].includes(_.fieldName))
  };
  switch(event.eventName) {
    case 'Mint':
    case 'Redeem':
      ret.title = fields.find((_)=>_.fieldName == 'Source')?.fieldValue + ' -> ' + event.eventName;
      ret.text = [
        'Amount : ',
        String(Number(fields.find((_)=>_.fieldName == (event.eventName == 'Mint' ? 'amountOut' : 'amountIn'))?.fieldValue || '0') / 1e18),
        '\n',
        fields.find((_)=>_.fieldName == 'Tx')?.fieldValue || ''
      ].join('');
      ret.fields = [];
      break;
    case 'IncrementGaugeWeight':
    case 'DecrementGaugeWeight':
      let gauge = fields.find((_)=>_.fieldName == 'gauge')?.fieldValue || '';
      let user = fields.find((_)=>_.fieldName == 'user')?.fieldValue || '';
      let termLabel = contractJsonFile.find((_)=>_.addr.toLowerCase() == gauge.toLowerCase())?.name || 'UNKNOWN_TERM';
      let userLabel = contractJsonFile.find((_)=>_.addr.toLowerCase() == user.toLowerCase())?.name || user;
      ret.title = (event.eventName == 'IncrementGaugeWeight' ? 'Gauge Increment' : 'Gauge Decrement') + ' -> ' + termLabel;
      ret.text = fields.find((_)=>_.fieldName == 'Tx')?.fieldValue || '';
      ret.text = [
        'Weight : ',
        String(Number(fields.find((_)=>_.fieldName == 'weight')?.fieldValue || '0') / 1e18),
        ' GUILD',
        userLabel.indexOf('SGM') !== -1 ? ' (through SGM)' : '',
        '\n',
        fields.find((_)=>_.fieldName == 'Tx')?.fieldValue || ''
      ].join('');
      ret.fields = [];
      break;
    case 'LoanOpen':
      ret.title = 'LoanOpen -> ' + sourceAddressLabel;
      ret.text = [
        'Borrowed : ',
        String(Number(fields.find((_)=>_.fieldName == 'borrowAmount')?.fieldValue || '0') / 1e18),
        '\n',
        fields.find((_)=>_.fieldName == 'Tx')?.fieldValue || ''
      ].join('');
      ret.fields = [];
      break;
    case 'LoanCall':
      ret.title = 'LoanCall -> ' + sourceAddressLabel;
      ret.text = [
        'id : ',
        fields.find((_)=>_.fieldName == 'loanId')?.fieldValue || '?',
        '\n',
        fields.find((_)=>_.fieldName == 'Tx')?.fieldValue || ''
      ].join('');
      ret.fields = [];
      break;
    case 'LoanClose':
      ret.title = 'LoanClose -> ' + sourceAddressLabel;
      ret.text = [
        'Repaid : ',
        String(Number(fields.find((_)=>_.fieldName == 'debtRepaid')?.fieldValue || '0') / 1e18),
        '\n',
        fields.find((_)=>_.fieldName == 'Tx')?.fieldValue || ''
      ].join('');
      ret.fields = [];
      break;
  }
  return ret;
}

StartSpamEventListener();
