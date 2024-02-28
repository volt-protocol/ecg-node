import { Contract, ethers, Interface, JsonRpcProvider } from 'ethers';
import { LendingTerm__factory } from '../contracts/types';
import { SendNotificationsList } from '../utils/Notifications';
import { norm } from '../utils/TokenUtils';
import OnboardingABI from '../contracts/abi/LendingTermOnboarding.json';
import * as dotenv from 'dotenv';
import { GetLendingTermOnboardingAddress, TOKENS } from '../config/Config';
import { sleep } from '../utils/Utils';
dotenv.config();

let onboardingContract: Contract | undefined;

const web3Provider = new ethers.JsonRpcProvider(process.env.RPC_URL, undefined, { staticNetwork: true });

async function TermOnboardingWatcher() {
  process.title = 'TERM_ONBOARDING_WATCHER';
  console.log('TermOnboardingWatcher: starting');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rpcURL = process.env.RPC_URL;
    if (!rpcURL) {
      throw new Error('Cannot find RPC_URL in env');
    }

    const onboardingAddress = GetLendingTermOnboardingAddress();

    if (onboardingContract) {
      console.log('TermOnboardingWatcher: resetting contract listener');
      onboardingContract.removeAllListeners();
    }

    onboardingContract = new Contract(onboardingAddress, OnboardingABI, web3Provider);
    const iface = new Interface(OnboardingABI);

    console.log(`TermOnboardingWatcher: Create/recreate listener for ProposalCreated events on ${onboardingAddress}`);
    await onboardingContract.on('*', async (event) => {
      await processEvent(event, web3Provider, iface);
    });

    await sleep(10 * 60 * 1000);
  }
}

async function processEvent(event: any, web3Provider: JsonRpcProvider, iface: Interface) {
  const parsed = iface.parseLog(event.log);
  if (parsed == null) {
    return;
  }

  if (parsed.name != 'ProposalCreated') {
    return;
  }

  /*description = string.concat(
            "[",
            Strings.toString(block.number),
            "]",
            " Enable term ",
            Strings.toHexString(term)
        );*/
  // extract term address from description
  const termAddress = parsed.args.description.split(' Enable term ')[1];
  const proposalId = parsed.args.proposalId;
  const proposer = parsed.args.proposer;
  const lendingTerm = LendingTerm__factory.connect(termAddress, web3Provider);

  const params = await lendingTerm.getParameters();

  let collateralTokenStr = params.collateralToken;
  const foundToken = TOKENS.find((_) => _.address == collateralTokenStr);
  if (foundToken) {
    collateralTokenStr += ` (${foundToken.symbol})`;
  }

  await SendNotificationsList('TermOnboarderWatcher', `New term ${termAddress} is proposed`, [
    {
      fieldName: 'Proposal Id',
      fieldValue: proposalId.toString(10)
    },
    {
      fieldName: 'Proposer',
      fieldValue: proposer
    },
    {
      fieldName: 'Collateral',
      fieldValue: collateralTokenStr
    },
    {
      fieldName: 'Hard Cap',
      fieldValue: params.hardCap.toString(10)
    },
    {
      fieldName: 'Interest rate',
      fieldValue: norm(params.interestRate).toString()
    },
    {
      fieldName: 'maxDebtPerCollateralToken',
      fieldValue: params.maxDebtPerCollateralToken.toString(10)
    }
  ]);
}

TermOnboardingWatcher();
