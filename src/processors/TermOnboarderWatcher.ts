import { Contract, ethers, Interface } from 'ethers';
import { LendingTerm__factory } from '../contracts/types';
import { sleep } from '../utils/Utils';
import { SendNotificationsList } from '../utils/Notifications';
import { norm } from '../utils/TokenUtils';
import OnboardingABI from '../contracts/abi/LendingTermOnboarding.json';
import * as dotenv from 'dotenv';
import { getTokenByAddress, TOKENS } from '../config/Config';
dotenv.config();

const RUN_EVERY_SEC = 60 * 10;

async function TermOnboarderWatcher() {
  // eslint-disable-next-line no-constant-condition
  process.title = 'TERM_ONBOARDER_WATCHER';
  console.log('TermOnboarderWatcher: starting');

  const rpcURL = process.env.RPC_URL;
  if (!rpcURL) {
    throw new Error('Cannot find RPC_URL in env');
  }

  const onboardingAddress = '0x3274ebe53c4fa1d0a59ad8fadbc6f944186b408e';

  const web3Provider = new ethers.JsonRpcProvider(rpcURL);
  const onboardingContract = new Contract(onboardingAddress, OnboardingABI, web3Provider);
  const iface = new Interface(OnboardingABI);

  console.log('Listening to ProposalCreated events on 0x3274ebe53c4fa1d0a59ad8fadbc6f944186b408e');
  await onboardingContract.on('*', async (event) => {
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
  });
}

TermOnboarderWatcher();
