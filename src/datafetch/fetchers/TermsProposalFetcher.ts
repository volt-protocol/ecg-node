import { JsonRpcProvider } from 'ethers';
import { GetDeployBlock, GetLendingTermFactoryAddress, getTokenByAddressNoError } from '../../config/Config';
import {
  LendingTermFactory__factory,
  LendingTerm__factory,
  LendingTerm as LendingTermType
} from '../../contracts/types';
import { MARKET_ID } from '../../utils/Constants';
import { roundTo } from '../../utils/Utils';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { Log } from '../../utils/Logger';
import { SyncData } from '../../model/SyncData';
import { FetchAllEventsAndExtractStringArray, GetERC20Infos } from '../../utils/Web3Helper';
import { Proposal, ProposalStatus } from '../../model/Proposal';
import { norm } from '../../utils/TokenUtils';

export default class TermsProposalFetcher {
  static async fetchProposals(web3Provider: JsonRpcProvider, syncData: SyncData, currentBlock: number) {
    Log('FetchECGData[Proposals]: starting');

    const createdProposal: Proposal[] = await fetchNewCreatedLendingTerms(web3Provider, syncData, currentBlock);

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

  const createdTermAddresses = await FetchAllEventsAndExtractStringArray(
    lendingTermFactory,
    'LendingTermFactory',
    filter,
    ['term'],
    startBlock,
    currentBlock
  );

  const allCreated: Proposal[] = [];

  // get all info with multicall
  const multicallProvider = MulticallWrapper.wrap(web3Provider);
  const promises = [];
  for (const termAddress of createdTermAddresses) {
    const lendingTermContract = LendingTerm__factory.connect(termAddress, multicallProvider);
    promises.push(lendingTermContract.getParameters());
  }

  const results = await Promise.all(promises);

  let cursor = 0;
  for (const termAddress of createdTermAddresses) {
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
      termName: label
    });
  }

  return allCreated;
}
