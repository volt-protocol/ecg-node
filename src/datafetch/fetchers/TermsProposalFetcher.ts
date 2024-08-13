import { JsonRpcProvider } from 'ethers';
import {
  GetDeployBlock,
  GetLendingTermFactoryAddress,
  GetLendingTermOnboardingAddress,
  GetLendingTermParamManagerAddress,
  getTokenByAddressNoError
} from '../../config/Config';
import {
  LendingTermFactory__factory,
  LendingTerm__factory,
  LendingTerm as LendingTermType,
  LendingTermOnboarding__factory,
  LendingTermParamManager__factory
} from '../../contracts/types';
import {
  BLOCK_PER_HOUR,
  DATA_DIR,
  EXPLORER_URI,
  MARKET_ID,
  TERM_ONBOARDING_WATCHER_ENABLED
} from '../../utils/Constants';
import { ReadJSON, WriteJSON, roundTo } from '../../utils/Utils';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { Log } from '../../utils/Logger';
import { SyncData } from '../../model/SyncData';
import { FetchAllEvents, GetERC20Infos, GetL1Web3Provider } from '../../utils/Web3Helper';
import {
  Proposal,
  ProposalParamName,
  ProposalParams,
  ProposalParamsFileStructure,
  ProposalStatus,
  ProposalsFileStructure
} from '../../model/Proposal';
import { norm } from '../../utils/TokenUtils';
import path from 'path';
import fs from 'fs';
import { SendNotificationsList } from '../../utils/Notifications';

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
      if (l1BlockNumber > p.voteEnd && p.status == ProposalStatus.PROPOSED) {
        // check if quorum reached
        const lendingTermOnboarding = LendingTermOnboarding__factory.connect(
          await GetLendingTermOnboardingAddress(),
          web3Provider
        );
        const proposalVotes = await lendingTermOnboarding.proposalVotes(p.proposalId);
        // if amount of vote for >= quorum, set status to QUORUM_REACHED
        if (proposalVotes.forVotes >= BigInt(p.quorum)) {
          p.status = ProposalStatus.QUORUM_REACHED;
        } else {
          resetProposalToCreated(p);
        }
      }
    }

    // remove all proposal with status CREATED and older than 7 days
    // EDIT FOR NOW KEEP ALL
    const proposalsToSave = allProposals;
    // const proposalsToSave = allProposals.filter(
    //   (_) =>
    //     // keep only those with status different than CREATE
    //     _.status != ProposalStatus.CREATED ||
    //     // of with status created but created less than 7 days ago
    //     (_.status == ProposalStatus.CREATED && _.createdBlock > currentBlock - 7 * BLOCK_PER_HOUR * 24)
    // );

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
    return proposalsToSave;
  }

  static async fetchProposalParams(
    web3Provider: JsonRpcProvider,
    syncData: SyncData,
    currentBlock: number,
    allTermProposals: Proposal[]
  ) {
    Log('FetchECGData[ProposalParams]: starting');

    let allProposals: ProposalParams[] = [];
    const proposalsFilePath = path.join(DATA_DIR, 'proposal-params.json');
    if (fs.existsSync(proposalsFilePath)) {
      const proposalsFile: ProposalParamsFileStructure = ReadJSON(proposalsFilePath);
      allProposals = proposalsFile.proposalParams;
    }

    await fetchProposalParamsEvents(web3Provider, syncData, currentBlock, allProposals, allTermProposals);
    // await fetchNewQueuedProposals(web3Provider, syncData, currentBlock, allProposals);
    // await fetchNewExecutedProposals(web3Provider, syncData, currentBlock, allProposals);
    // await fetchNewCanceledProposals(web3Provider, syncData, currentBlock, allProposals);

    // reset all 'PROPOSED' proposals with voteEnd elapsed
    // BE CAREFULL FOR ARBITRUM VOTE END IS IN L1 BLOCK NUMBER NOT ARBITRUM BLOCK NUMBER
    const l1provider = GetL1Web3Provider();
    const l1BlockNumber = await l1provider.getBlockNumber();

    for (const p of allProposals) {
      if (l1BlockNumber > p.voteEnd && p.status == ProposalStatus.PROPOSED) {
        // check if quorum reached
        const lendingTermParamManager = LendingTermParamManager__factory.connect(
          await GetLendingTermParamManagerAddress(),
          web3Provider
        );
        const proposalVotes = await lendingTermParamManager.proposalVotes(p.proposalId);
        // if amount of vote for >= quorum, set status to QUORUM_REACHED
        if (proposalVotes.forVotes >= BigInt(p.quorum)) {
          p.status = ProposalStatus.QUORUM_REACHED;
        } else {
          resetProposalParamsToCreated(p);
        }
      }
    }

    // remove all proposal with status CREATED and older than 7 days
    // EDIT FOR NOW KEEP ALL
    const proposalsToSave = allProposals;
    // const proposalsToSave = allProposals.filter(
    //   (_) =>
    //     // keep only those with status different than CREATE
    //     _.status != ProposalStatus.CREATED ||
    //     // of with status created but created less than 7 days ago
    //     (_.status == ProposalStatus.CREATED && _.createdBlock > currentBlock - 7 * BLOCK_PER_HOUR * 24)
    // );

    const fileToUpdate: ProposalParamsFileStructure = {
      proposalParams: proposalsToSave,
      updateBlock: currentBlock,
      updated: Date.now(),
      updatedHuman: new Date(Date.now()).toISOString()
    };

    WriteJSON(proposalsFilePath, fileToUpdate);

    if (!syncData.proposalParamsSync) {
      syncData.proposalParamsSync = {
        lastBlockFetched: currentBlock
      };
    }

    syncData.proposalParamsSync.lastBlockFetched = currentBlock;
    Log('FetchECGData[ProposalParams]: ending');
  }
}

async function fetchNewCreatedLendingTerms(
  web3Provider: JsonRpcProvider,
  syncData: SyncData,
  currentBlock: number
): Promise<Proposal[]> {
  const lendingTermFactory = LendingTermFactory__factory.connect(await GetLendingTermFactoryAddress(), web3Provider);

  let startBlock = await GetDeployBlock();
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
    promises.push(lendingTermContract.auctionHouse());
  }

  const results = await Promise.all(promises);

  let cursor = 0;
  for (const termEvent of createdTermEvents) {
    const termAddress = termEvent.args.term;
    const createdBlock = termEvent.blockNumber;
    const termParameters = results[cursor++] as LendingTermType.LendingTermParamsStructOutput;
    const auctionHouse = results[cursor++] as string;
    const interestRate = termParameters.interestRate.toString(10);
    const maxDebtPerCol = termParameters.maxDebtPerCollateralToken.toString(10);
    const collateralTokenAddress = termParameters.collateralToken;
    let collateralToken = await getTokenByAddressNoError(collateralTokenAddress);
    let knownToken = true;
    if (!collateralToken) {
      collateralToken = await GetERC20Infos(web3Provider, collateralTokenAddress);
      knownToken = false;
    }
    const borrowRatio = norm(maxDebtPerCol, 36 - collateralToken.decimals);

    allCreated.push({
      termAddress: termAddress,
      maxDebtPerCollateralToken: maxDebtPerCol,
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
      termName:
        `${collateralToken.symbol}` + `-${roundTo(borrowRatio, 2)}` + `-${roundTo(norm(interestRate) * 100, 2)}%`,
      description: '',
      values: [],
      targets: [],
      calldatas: [],
      proposalId: '',
      proposer: '',
      voteEnd: 0,
      voteStart: 0,
      quorum: '',
      createdBlock: createdBlock,
      auctionHouse: auctionHouse
    });
  }

  return allCreated;
}

async function fetchProposalParamsEvents(
  web3Provider: JsonRpcProvider,
  syncData: SyncData,
  currentBlock: number,
  allProposals: ProposalParams[],
  allTermProposals: Proposal[]
) {
  const lendingTermParamManager = LendingTermParamManager__factory.connect(
    await GetLendingTermParamManagerAddress(),
    web3Provider
  );

  let startBlock = await GetDeployBlock();
  if (syncData.proposalParamsSync) {
    startBlock = syncData.proposalParamsSync.lastBlockFetched + 1;
  }
  //   const filter = lendingTermOnboarding.filters.ProposalCreated();

  const filter = [
    (await lendingTermParamManager.filters.ProposalCreated().getTopicFilter()).toString(),
    (await lendingTermParamManager.filters.ProposalExecuted().getTopicFilter()).toString(),
    (await lendingTermParamManager.filters.ProposalQueued().getTopicFilter()).toString(),
    (await lendingTermParamManager.filters.ProposalCanceled().getTopicFilter()).toString()
  ];
  const proposalEvents = await FetchAllEvents(
    lendingTermParamManager,
    'lendingTermParamManager',
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
      const calldatas = proposalCreated.args.calldatas as string[];
      const values = (proposalCreated.args.values as bigint[]).map((_) => _.toString(10));
      const targets = proposalCreated.args.targets as string[];
      const voteStart = proposalCreated.args.voteStart as bigint;
      const voteEnd = proposalCreated.args.voteEnd as bigint;
      const quorum = await lendingTermParamManager.quorum(voteStart);

      /* Update borrow ratio [20513359] set maxDebtPerCollateralToken of term 0xfea0e00f93623d79045ce2bc b8715ab5c64149ab to 710000000000000000*/

      const matches = description.match(/(of term 0x[a-z0-9]+)/g);
      if (!matches) {
        throw new Error(`Cannot extract term address from ${description}`);
      }

      const termAddressFromDescription = matches[0].split('of term ')[1];

      const foundTermForMarket = allTermProposals.find(
        (_) => _.termAddress.toLowerCase() == termAddressFromDescription.toLowerCase()
      );

      if (!foundTermForMarket) {
        // ignore, it may be for other market
        continue;
      }

      let paramName = ProposalParamName.HARD_CAP;
      if (description.startsWith('Update borrow ratio')) {
        paramName = ProposalParamName.MAX_DEBT_PER_COLLATERAL_TOKEN;
      } else if (description.startsWith('Update interest rate')) {
        paramName = ProposalParamName.INTEREST_RATE;
      }

      const paramValue = description.split(' ').at(-1); // value is always the last value after last space
      if (!paramValue) {
        throw new Error(`Cannot extract param value from ${description}`);
      }

      const prop = {
        proposalId: proposalId.toString(),
        proposer: proposer,
        description: description,
        calldatas: calldatas,
        values: values,
        targets: targets,
        voteStart: Number(voteStart),
        voteEnd: Number(voteEnd),
        status: ProposalStatus.PROPOSED,
        termAddress: termAddressFromDescription,
        createdBlock: proposalCreated.blockNumber,
        paramName: paramName,
        paramValue: paramValue,
        quorum: quorum.toString()
      };
      allProposals.push(prop);

      // send notification only if it's been proposed less than 12 hours ago
      if (TERM_ONBOARDING_WATCHER_ENABLED && proposalCreated.blockNumber > currentBlock - 12 * BLOCK_PER_HOUR) {
        await SendNotificationsList(
          'Term Params Manager Watcher',
          'New term param is proposed',
          [
            {
              fieldName: 'Lending term',
              fieldValue: `${foundTermForMarket.termName} - ${EXPLORER_URI}/address/${prop.termAddress}`
            },
            {
              fieldName: 'Proposal Id',
              fieldValue: proposalId.toString(10)
            },
            {
              fieldName: 'Proposer',
              fieldValue: proposer
            },
            {
              fieldName: 'Parameter',
              fieldValue: prop.paramName.toString()
            },
            {
              fieldName: 'Proposed value',
              fieldValue: prop.paramValue
            }
          ],
          true
        );
      }
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
        resetProposalParamsToCreated(foundProposal);
      }
    }
  }
}

async function fetchProposalEvents(
  web3Provider: JsonRpcProvider,
  syncData: SyncData,
  currentBlock: number,
  allProposals: Proposal[]
) {
  const lendingTermOnboarding = LendingTermOnboarding__factory.connect(
    await GetLendingTermOnboardingAddress(),
    web3Provider
  );

  let startBlock = await GetDeployBlock();
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
      const calldatas = proposalCreated.args.calldatas as string[];
      const values = (proposalCreated.args.values as bigint[]).map((_) => _.toString(10));
      const targets = proposalCreated.args.targets as string[];
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
      foundProposal.calldatas = calldatas;
      foundProposal.values = values;
      foundProposal.targets = targets;
      foundProposal.voteStart = Number(voteStart);
      foundProposal.voteEnd = Number(voteEnd);
      foundProposal.status = ProposalStatus.PROPOSED;
      const quorum = await lendingTermOnboarding.quorum(voteStart);
      foundProposal.quorum = quorum.toString();

      // send notification only if it's been proposed less than 12 hours ago
      if (TERM_ONBOARDING_WATCHER_ENABLED && proposalCreated.blockNumber > currentBlock - 12 * BLOCK_PER_HOUR) {
        await SendNotificationsList(
          'TermOnboardingWatcher',
          'New term is proposed',
          [
            {
              fieldName: 'Lending term',
              fieldValue: `${EXPLORER_URI}/address/${foundProposal.termAddress}`
            },
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
              fieldValue: foundProposal.collateralTokenSymbol
            },
            {
              fieldName: 'Hard Cap',
              fieldValue: foundProposal.hardCap
            },
            {
              fieldName: 'Interest rate',
              fieldValue: norm(foundProposal.interestRate).toString()
            },
            {
              fieldName: 'maxDebtPerCollateralToken',
              fieldValue: foundProposal.maxDebtPerCollateralToken
            }
          ],
          true
        );
      }
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
        resetProposalToCreated(foundProposal);
      }
    }
  }
}

function resetProposalToCreated(proposal: Proposal) {
  proposal.status = ProposalStatus.CREATED;
  proposal.proposalId = '';
  proposal.description = '';
  proposal.targets = [];
  proposal.values = [];
  proposal.calldatas = [];
  proposal.proposer = '';
  proposal.quorum = '';
  proposal.voteEnd = 0;
  proposal.voteStart = 0;
}

function resetProposalParamsToCreated(proposal: ProposalParams) {
  proposal.status = ProposalStatus.CREATED;
  proposal.proposalId = '';
  proposal.description = '';
  proposal.targets = [];
  proposal.values = [];
  proposal.calldatas = [];
  proposal.proposer = '';
  proposal.quorum = '';
  proposal.voteEnd = 0;
  proposal.voteStart = 0;
  proposal.paramName = ProposalParamName.HARD_CAP;
  proposal.paramValue = '';
}
