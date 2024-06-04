import { BaseContract, JsonRpcProvider } from 'ethers';
import { ProtocolData } from '../../model/ProtocolData';
import { SyncData } from '../../model/SyncData';
import { LastActivity, LastActivityFileStructure } from '../../model/LastActivity';
import { BLOCK_PER_HOUR, DATA_DIR } from '../../utils/Constants';
import path from 'path';
import fs from 'fs';
import { ReadJSON, WriteJSON } from '../../utils/Utils';
import LendingTerm from '../../model/LendingTerm';
import {
  GuildGovernor__factory,
  GuildVetoGovernor__factory,
  LendingTermOffboarding__factory,
  LendingTermOnboarding__factory,
  LendingTerm__factory,
  SimplePSM__factory
} from '../../contracts/types';
import { FetchAllEvents } from '../../utils/Web3Helper';
import {
  GetCreditTokenAddress,
  GetDaoGovernorGuildAddress,
  GetDaoVetoGuildAddress,
  GetLendingTermOffboardingAddress,
  GetLendingTermOnboardingAddress,
  GetPSMAddress,
  GetPegTokenAddress,
  getTokenByAddress
} from '../../config/Config';
import { norm } from '../../utils/TokenUtils';
import logger from '../../utils/Logger';

export default class LastActivityFetcher {
  static async fetchAndSaveActivity(
    syncData: SyncData,
    web3Provider: JsonRpcProvider,
    currentBlock: number,
    protocolData: ProtocolData,
    terms: LendingTerm[]
  ) {
    logger.info('FetchECGData[LastActivity]: starting');

    // read already saved activity
    let alreadySavedActivities: LastActivity[] = [];
    const lastActivityPath = path.join(DATA_DIR, 'last-activity.json');
    if (fs.existsSync(lastActivityPath)) {
      const lastActivityFile: LastActivityFileStructure = ReadJSON(lastActivityPath);
      alreadySavedActivities = lastActivityFile.activities;
    }

    // clean too old activities
    const minBlockToKeep = currentBlock - 7 * 24 * BLOCK_PER_HOUR;
    const activitiesToSave = alreadySavedActivities.filter((_) => _.block >= minBlockToKeep);

    // fetch new activities
    const loanActivities = await getLoanActivity(syncData, web3Provider, currentBlock, terms);
    activitiesToSave.push(...loanActivities);

    const mintRedeemActivities = await getMintRedeemActivity(syncData, web3Provider, currentBlock);
    activitiesToSave.push(...mintRedeemActivities);

    const voteActivities = await getVoteActivities(syncData, web3Provider, currentBlock);
    activitiesToSave.push(...voteActivities);

    // sort desc by block
    activitiesToSave.sort((a, b) => b.block - a.block);

    const lastActivityFile: LastActivityFileStructure = {
      activities: activitiesToSave,
      updated: Date.now(),
      updatedHuman: new Date(Date.now()).toISOString()
    };
    logger.debug(`FetchECGData[LastActivity]: saving ${activitiesToSave.length} activities`);

    WriteJSON(lastActivityPath, lastActivityFile);
    if (!syncData.activitySync) {
      syncData.activitySync = {
        lastBlockFetched: currentBlock
      };
    }

    syncData.activitySync.lastBlockFetched = currentBlock;

    return activitiesToSave;
  }
}
async function getLoanActivity(
  syncData: SyncData,
  web3Provider: JsonRpcProvider,
  currentBlock: number,
  terms: LendingTerm[]
): Promise<LastActivity[]> {
  logger.debug('FetchECGData[LastActivity]: starting getLoanActivity');
  const allLoanActivities: LastActivity[] = [];

  const fromBlock = syncData.activitySync
    ? syncData.activitySync.lastBlockFetched + 1
    : currentBlock - 7 * 24 * BLOCK_PER_HOUR;

  const promises: Promise<LastActivity[]>[] = [];
  for (const term of terms) {
    const promise = fetchLoanActivityForTerm(term, web3Provider, fromBlock, currentBlock);
    promises.push(promise);
    await promise; // disable parallel fetching
  }

  const results = await Promise.all(promises);
  for (const r of results) {
    allLoanActivities.push(...r);
  }

  logger.debug('FetchECGData[LastActivity]: ending getLoanActivity');
  return allLoanActivities;
}

async function fetchLoanActivityForTerm(
  term: LendingTerm,
  web3Provider: JsonRpcProvider,
  fromBlock: number,
  currentBlock: number
) {
  const loanActivities: LastActivity[] = [];
  const termContract = LendingTerm__factory.connect(term.termAddress, web3Provider);
  const allLoanOpen = await FetchAllEvents(
    termContract,
    `term-${term.termAddress}`,
    'LoanOpen',
    fromBlock,
    currentBlock
  );

  for (const loanOpen of allLoanOpen) {
    loanActivities.push({
      termAddress: term.termAddress,
      block: loanOpen.blockNumber,
      userAddress: loanOpen.args.borrower,
      category: 'loan',
      type: 'opening',
      txHash: loanOpen.transactionHash,
      txHashOpen: loanOpen.transactionHash,
      txHashClose: '',
      description: 'Opened Loan',
      amountIn: 0,
      amountOut: 0,
      vote: ''
    });
  }

  const allLoanClose = await FetchAllEvents(
    termContract,
    `term-${term.termAddress}`,
    'LoanClose',
    fromBlock,
    currentBlock
  );

  for (const loanClose of allLoanClose) {
    loanActivities.push({
      termAddress: term.termAddress,
      block: loanClose.blockNumber,
      userAddress: term.termAddress,
      category: 'loan',
      type: 'closing',
      txHash: loanClose.transactionHash,
      txHashClose: loanClose.transactionHash,
      txHashOpen: '',
      description: 'Closed Loan',
      amountIn: 0,
      amountOut: 0,
      vote: ''
    });
  }

  return loanActivities;
}

async function getMintRedeemActivity(
  syncData: SyncData,
  web3Provider: JsonRpcProvider,
  currentBlock: number
): Promise<LastActivity[]> {
  const mintRedeemActivities: LastActivity[] = [];

  const fromBlock = syncData.activitySync
    ? syncData.activitySync.lastBlockFetched + 1
    : currentBlock - 7 * 24 * BLOCK_PER_HOUR;

  const psmContract = SimplePSM__factory.connect(GetPSMAddress(), web3Provider);

  const creditToken = getTokenByAddress(GetCreditTokenAddress());
  const pegToken = getTokenByAddress(GetPegTokenAddress());

  const allMints = await FetchAllEvents(psmContract, `psm-${GetPSMAddress()}`, 'Mint', fromBlock, currentBlock);
  for (const mint of allMints) {
    const amountIn = norm(mint.args.amountIn, pegToken.decimals);
    const amountOut = norm(mint.args.amountOut, creditToken.decimals);
    mintRedeemActivities.push({
      termAddress: '',
      block: mint.blockNumber,
      userAddress: mint.args.to,
      category: 'mintRedeem',
      type: 'Mint',
      txHash: mint.transactionHash,
      txHashClose: '',
      txHashOpen: '',
      amountIn: amountIn,
      amountOut: amountOut,
      description: `Minted ${amountIn} ${creditToken.symbol}`,
      vote: ''
    });
  }

  const allRedeems = await FetchAllEvents(psmContract, `psm-${GetPSMAddress()}`, 'Redeem', fromBlock, currentBlock);
  for (const redeem of allRedeems) {
    const amountIn = norm(redeem.args.amountIn, creditToken.decimals);
    const amountOut = norm(redeem.args.amountOut, pegToken.decimals);
    mintRedeemActivities.push({
      termAddress: '',
      block: redeem.blockNumber,
      userAddress: redeem.args.to,
      category: 'mintRedeem',
      type: 'Redeem',
      txHash: redeem.transactionHash,
      txHashClose: '',
      txHashOpen: '',
      amountIn: amountIn,
      amountOut: amountOut,
      description: `Redeemed ${amountOut} ${pegToken.symbol}`,
      vote: ''
    });
  }

  return mintRedeemActivities;
}

async function getVoteActivities(
  syncData: SyncData,
  web3Provider: JsonRpcProvider,
  currentBlock: number
): Promise<LastActivity[]> {
  const voteActivities: LastActivity[] = [];

  const fromBlock = syncData.activitySync
    ? syncData.activitySync.lastBlockFetched + 1
    : currentBlock - 7 * 24 * BLOCK_PER_HOUR;

  const offboardingContract = LendingTermOffboarding__factory.connect(GetLendingTermOffboardingAddress(), web3Provider);

  const allOffboardSupport = await FetchAllEvents(
    offboardingContract,
    `offboardingContract-${GetLendingTermOffboardingAddress()}`,
    'OffboardSupport',
    fromBlock,
    currentBlock
  );

  for (const offboardSupport of allOffboardSupport) {
    voteActivities.push({
      termAddress: offboardSupport.args.term,
      block: offboardSupport.blockNumber,
      userAddress: offboardSupport.args.user,
      category: 'vote',
      type: 'LendingTermOffboarding',
      txHash: offboardSupport.transactionHash,
      txHashClose: '',
      txHashOpen: '',
      amountIn: 0,
      amountOut: 0,
      description: '',
      vote: 'for'
    });
  }
  const onboardingContract = LendingTermOnboarding__factory.connect(GetLendingTermOnboardingAddress(), web3Provider);
  const onboardingVotes = await getGovernorActivities(
    onboardingContract,
    'LendingTermOnboarding',
    `LendingTermOnboarding-${GetLendingTermOnboardingAddress()}`,
    fromBlock,
    currentBlock
  );
  voteActivities.push(...onboardingVotes);

  const daoGuildGovernorContract = GuildGovernor__factory.connect(GetDaoGovernorGuildAddress(), web3Provider);
  const daoGovernorVotes = await getGovernorActivities(
    daoGuildGovernorContract,
    'Governor',
    `Governor-${GetDaoGovernorGuildAddress()}`,
    fromBlock,
    currentBlock
  );
  voteActivities.push(...daoGovernorVotes);

  const daoVetoGovernorContract = GuildVetoGovernor__factory.connect(GetDaoVetoGuildAddress(), web3Provider);
  const daoVetoVotes = await getGovernorActivities(
    daoVetoGovernorContract,
    'VetoGovernor',
    `VetoGovernor-${GetDaoVetoGuildAddress()}`,
    fromBlock,
    currentBlock
  );
  voteActivities.push(...daoVetoVotes);

  return voteActivities;
}

async function getGovernorActivities(
  contract: BaseContract,
  type: string,
  contractName: string,
  fromBlock: number,
  toBlock: number
): Promise<LastActivity[]> {
  const activities: LastActivity[] = [];
  const votes = await FetchAllEvents(contract, contractName, 'VoteCast', fromBlock, toBlock);

  for (const vote of votes) {
    activities.push({
      termAddress: '',
      block: vote.blockNumber,
      userAddress: vote.args.voter,
      category: 'vote',
      type: type,
      txHash: vote.transactionHash,
      txHashClose: '',
      txHashOpen: '',
      amountIn: 0,
      amountOut: 0,
      description: '',
      vote: Number(vote.args.support) === 0 ? 'against' : Number(vote.args.support) === 1 ? 'for' : 'abstain'
    });
  }

  return activities;
}
