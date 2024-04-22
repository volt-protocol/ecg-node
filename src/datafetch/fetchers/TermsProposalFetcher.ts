import { JsonRpcProvider } from 'ethers';
import {
  GetDeployBlock,
  GetLendingTermFactoryAddress,
  GetLendingTermOnboardingAddress,
  getTokenByAddressNoError
} from '../../config/Config';
import {
  LendingTermFactory__factory,
  LendingTerm__factory,
  LendingTerm as LendingTermType,
  LendingTermOnboarding__factory
} from '../../contracts/types';
import { BLOCK_PER_HOUR, DATA_DIR, MARKET_ID } from '../../utils/Constants';
import { ReadJSON, WriteJSON, roundTo } from '../../utils/Utils';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { Log } from '../../utils/Logger';
import { SyncData } from '../../model/SyncData';
import { FetchAllEvents, GetERC20Infos, GetL1Web3Provider } from '../../utils/Web3Helper';
import { Proposal, ProposalStatus, ProposalsFileStructure } from '../../model/Proposal';
import { norm } from '../../utils/TokenUtils';
import path from 'path';
import fs from 'fs';

export default class TermsProposalFetcher {
  static async fetchProposals(web3Provider: JsonRpcProvider, syncData: SyncData, currentBlock: number) {
    Log('FetchECGData[Proposals]: starting');

    let allProposals: Proposal[] = [];
    const proposalsFilePath = path.join(DATA_DIR, 'proposals.json');
    if (fs.existsSync(proposalsFilePath)) {
      const proposalsFile: ProposalsFileStructure = ReadJSON(proposalsFilePath);
      allProposals = proposalsFile.proposals;
    }

    const createdProposals: Proposal[] = await fetchNewCreatedLendingTerms(web3Provider, syncData, currentBlock);

    allProposals.push(...createdProposals);

    await fetchProposalEvents(web3Provider, syncData, currentBlock, allProposals);
    // await fetchNewQueuedProposals(web3Provider, syncData, currentBlock, allProposals);
    // await fetchNewExecutedProposals(web3Provider, syncData, currentBlock, allProposals);
    // await fetchNewCanceledProposals(web3Provider, syncData, currentBlock, allProposals);

    // reset all 'PROPOSED' proposals with voteEnd elapsed
    // BE CAREFULL FOR ARBITRUM VOTE END IS IN L1 BLOCK NUMBER NOT ARBITRUM BLOCK NUMBER
    const l1provider = GetL1Web3Provider();
    const l1BlockNumber = await l1provider.getBlockNumber();

    for (const p of allProposals) {
      if (p.voteEnd < l1BlockNumber && p.status == ProposalStatus.PROPOSED) {
        p.status = ProposalStatus.CREATED;
        p.proposalId = '';
        p.description = '';
        p.proposer = '';
        p.quorum = '';
        p.voteEnd = 0;
        p.voteStart = 0;
      }
    }

    // remove all proposal with status CREATED and older than 7 days
    const proposalsToSave = allProposals.filter(
      (_) =>
        // keep only those with status different than CREATE
        _.status != ProposalStatus.CREATED ||
        // of with status created but created less than 7 days ago
        (_.status == ProposalStatus.CREATED && _.createdBlock < currentBlock - 7 * BLOCK_PER_HOUR * 24)
    );

    const fileToUpdate: ProposalsFileStructure = {
      proposals: proposalsToSave,
      updateBlock: currentBlock,
      updated: Date.now(),
      updatedHuman: new Date(Date.now()).toISOString()
    };

    WriteJSON(proposalsFilePath, fileToUpdate);

    if (!syncData.proposalSync) {
      syncData.proposalSync = {
        lastBlockFetched: currentBlock
      };
    }

    syncData.proposalSync.lastBlockFetched = currentBlock;
    Log('FetchECGData[Proposals]: ending');
  }
}

async function fetchNewCreatedLendingTerms(
  web3Provider: JsonRpcProvider,
  syncData: SyncData,
  currentBlock: number
): Promise<Proposal[]> {
  const lendingTermFactory = LendingTermFactory__factory.connect(GetLendingTermFactoryAddress(), web3Provider);

  let startBlock = GetDeployBlock();
  if (syncData.proposalSync) {
    startBlock = syncData.proposalSync.lastBlockFetched + 1;
  }
  const filter = lendingTermFactory.filters.TermCreated(undefined, MARKET_ID, undefined, undefined);

  const createdTermEvents = await FetchAllEvents(
    lendingTermFactory,
    'LendingTermFactory',
    filter,
    startBlock,
    currentBlock
  );

  const allCreated: Proposal[] = [];

  // get all info with multicall
  const multicallProvider = MulticallWrapper.wrap(web3Provider);
  const promises = [];
  for (const termEvent of createdTermEvents) {
    const termAddress = termEvent.args.term;
    const lendingTermContract = LendingTerm__factory.connect(termAddress, multicallProvider);
    promises.push(lendingTermContract.getParameters());
  }

  const results = await Promise.all(promises);

  let cursor = 0;
  for (const termEvent of createdTermEvents) {
    const termAddress = termEvent.args.term;
    const createdBlock = termEvent.blockNumber;
    const termParameters: LendingTermType.LendingTermParamsStructOutput = results[cursor++];
    const interestRate = termParameters.interestRate.toString(10);
    const maxDebtPerCol = termParameters.maxDebtPerCollateralToken.toString(10);
    const collateralTokenAddress = termParameters.collateralToken;
    let collateralToken = getTokenByAddressNoError(collateralTokenAddress);
    let knownToken = true;
    if (!collateralToken) {
      collateralToken = await GetERC20Infos(web3Provider, collateralTokenAddress);
      knownToken = false;
    }
    const borrowRatio = norm(maxDebtPerCol, 36 - collateralToken.decimals);

    const label =
      `${collateralToken.symbol}` + `-${roundTo(norm(interestRate) * 100, 2)}%` + `-${roundTo(borrowRatio, 2)}`;
    allCreated.push({
      termAddress: termAddress,
      borrowRatio: borrowRatio,
      collateralTokenAddress: collateralTokenAddress,
      collateralTokenDecimals: collateralToken.decimals,
      collateralTokenSymbol: collateralToken.symbol,
      knownToken: knownToken,
      hardCap: termParameters.hardCap.toString(10),
      interestRate: interestRate,
      maxDelayBetweenPartialRepay: Number(termParameters.maxDelayBetweenPartialRepay),
      openingFee: termParameters.openingFee.toString(10),
      minPartialRepayPercent: norm(termParameters.minPartialRepayPercent),
      status: ProposalStatus.CREATED,
      termName: label,
      description: '',
      proposalId: '',
      proposer: '',
      voteEnd: 0,
      voteStart: 0,
      quorum: '',
      createdBlock: createdBlock
    });
  }

  return allCreated;
}

async function fetchProposalEvents(
  web3Provider: JsonRpcProvider,
  syncData: SyncData,
  currentBlock: number,
  allProposals: Proposal[]
) {
  const lendingTermOnboarding = LendingTermOnboarding__factory.connect(GetLendingTermOnboardingAddress(), web3Provider);

  let startBlock = GetDeployBlock();
  if (syncData.proposalSync) {
    startBlock = syncData.proposalSync.lastBlockFetched + 1;
  }
  //   const filter = lendingTermOnboarding.filters.ProposalCreated();

  const filter = [
    (await lendingTermOnboarding.filters.ProposalCreated().getTopicFilter()).toString(),
    (await lendingTermOnboarding.filters.ProposalExecuted().getTopicFilter()).toString(),
    (await lendingTermOnboarding.filters.ProposalQueued().getTopicFilter()).toString(),
    (await lendingTermOnboarding.filters.ProposalCanceled().getTopicFilter()).toString()
  ];
  const proposalEvents = await FetchAllEvents(
    lendingTermOnboarding,
    'lendingTermOnboarding',
    [filter],
    startBlock,
    currentBlock
  );

  for (const proposalEvent of proposalEvents) {
    if (proposalEvent.logName == 'ProposalCreated') {
      const proposalCreated = proposalEvent;
      const proposalId = proposalCreated.args.proposalId as bigint;
      const proposer = proposalCreated.args.proposer as string;
      const description = proposalCreated.args.description as string;
      const voteStart = proposalCreated.args.voteStart as bigint;
      const voteEnd = proposalCreated.args.voteEnd as bigint;
      const termAddressFromDescription = proposalCreated.args.description.split(' Enable term ')[1];

      const foundProposal = allProposals.find(
        (_) => _.termAddress.toLowerCase() == termAddressFromDescription.toLowerCase()
      );

      if (!foundProposal) {
        // ignore, it may be for other market
        continue;
      }

      foundProposal.proposalId = proposalId.toString(10);
      foundProposal.proposer = proposer;
      foundProposal.description = description;
      foundProposal.voteStart = Number(voteStart);
      foundProposal.voteEnd = Number(voteEnd);
      foundProposal.status = ProposalStatus.PROPOSED;
      const quorum = await lendingTermOnboarding.quorum(proposalId);
      foundProposal.quorum = quorum.toString();
    } else {
      const proposalId = proposalEvent.args.proposalId as bigint;

      const foundProposal = allProposals.find((_) => _.proposalId == proposalId.toString());

      if (!foundProposal) {
        // ignore, it may be for other market
        continue;
      }

      if (proposalEvent.logName == 'ProposalQueued') {
        foundProposal.status = ProposalStatus.QUEUED;
      }
      if (proposalEvent.logName == 'ProposalExecuted') {
        foundProposal.status = ProposalStatus.ACTIVE;
      }
      if (proposalEvent.logName == 'ProposalCanceled') {
        foundProposal.status = ProposalStatus.CREATED;
        foundProposal.proposalId = '';
        foundProposal.description = '';
        foundProposal.proposer = '';
        foundProposal.quorum = '';
        foundProposal.voteEnd = 0;
        foundProposal.voteStart = 0;
      }
    }
  }
}
