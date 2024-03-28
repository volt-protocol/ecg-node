import { Contract, ethers, Interface, JsonRpcProvider } from 'ethers';
import { LendingTerm__factory } from '../contracts/types';
import { SendNotificationsList } from '../utils/Notifications';
import { norm } from '../utils/TokenUtils';
import OnboardingABI from '../contracts/abi/LendingTermOnboarding.json';
import * as dotenv from 'dotenv';
import { GetLendingTermOnboardingAddress, getTokenByAddress, LoadConfiguration, TokenConfig } from '../config/Config';
import { sleep } from '../utils/Utils';
import { GetWeb3Provider } from '../utils/Web3Helper';
import { Log } from '../utils/Logger';
dotenv.config();

let onboardingContract: Contract | undefined;

const web3Provider = GetWeb3Provider(15000);

async function TermOnboardingWatcher() {
  process.title = 'ECG_NODE_TERM_ONBOARDING_WATCHER';
  Log('starting');

  const atLeastOneNotificationChannelEnabled =
    (process.env.WATCHER_TG_BOT_ID != undefined && process.env.WATCHER_TG_CHAT_ID != undefined) ||
    process.env.WATCHER_DISCORD_WEBHOOK_URL != undefined;

  if (!atLeastOneNotificationChannelEnabled) {
    throw new Error('At least one notification channel must be enabled');
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // load external config
    await LoadConfiguration();
    const onboardingAddress = GetLendingTermOnboardingAddress();

    if (onboardingContract) {
      Log('resetting contract listener');
      onboardingContract.removeAllListeners();
    }

    onboardingContract = new Contract(onboardingAddress, OnboardingABI, web3Provider);
    const iface = new Interface(OnboardingABI);

    Log(`Create/recreate listener for ProposalCreated events on ${onboardingAddress}`);
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
  let foundToken: TokenConfig | undefined = undefined;

  try {
    foundToken = getTokenByAddress(collateralTokenStr);
  } catch (e) {
    Log(`Cannot find token with address: ${collateralTokenStr}`);
  }

  if (foundToken) {
    collateralTokenStr += ` (${foundToken.symbol})`;
  }

  await SendNotificationsList(
    'TermOnboarderWatcher',
    `New term ${termAddress} is proposed`,
    [
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
    ],
    true
  );
}

TermOnboardingWatcher();
