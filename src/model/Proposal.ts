export interface Proposal {
  status: ProposalStatus;
  termAddress: string;
  collateralTokenAddress: string;
  collateralTokenSymbol: string;
  collateralTokenDecimals: number;
  knownToken: boolean;
  termName: string;
  openingFee: string;
  interestRate: string;
  borrowRatio: number;
  maxDelayBetweenPartialRepay: number;
  minPartialRepayPercent: number;
  hardCap: string;
}

export enum ProposalStatus {
  CREATED = 'created', // term is created
  PROPOSED = 'proposed', // term is proposed (onboarding)
  QUEUED = 'queued', // term is queued to be added, can still be vetoed
  ACTIVE = 'active' // validated, the term is added to the gauges
}

export interface ProposalFileStructure {
  updated: number;
  updateBlock: number;
  updatedHuman: string;
  proposals: Proposal[];
}
