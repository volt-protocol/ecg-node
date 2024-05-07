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
  calldatas: string[];
  values: string[];
  targets: string[];
  proposer: string;
  voteStart: number;
  voteEnd: number;
  quorum: string;
  auctionHouse: string;
}

export enum ProposalStatus {
  CREATED = 'created', // term is created
  PROPOSED = 'proposed', // term is proposed (onboarding)
  QUEUED = 'queued', // term is queued to be added, can still be vetoed
  ACTIVE = 'active' // validated, the term is added to the gauges
}

export interface ProposalsFileStructure {
  updated: number;
  updateBlock: number;
  updatedHuman: string;
  proposals: Proposal[];
}
