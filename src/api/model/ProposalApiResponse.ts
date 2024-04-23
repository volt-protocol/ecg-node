import { ProposalStatus } from '../../model/Proposal';

export interface Proposal {
  status: ProposalStatus;
  createdBlock: number;
  termAddress: string;
  collateralTokenAddress: string;
  collateralTokenSymbol: string;
  collateralTokenDecimals: number;
  knownToken: boolean;
  termName: string;
  openingFee: string;
  interestRate: string;
  borrowRatio: number;
  maxDebtPerCollateralToken: string;
  maxDelayBetweenPartialRepay: number;
  minPartialRepayPercent: number;
  hardCap: string;
  proposalId: string;
  description: string;
  proposer: string;
  voteStart: number;
  voteEnd: number;
  quorum: string;
}

export interface ProposalsApiResponse {
  updated: number;
  updateBlock: number;
  updatedHuman: string;
  proposals: Proposal[];
}
