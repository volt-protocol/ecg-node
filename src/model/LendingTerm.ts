export default interface LendingTerm {
  termAddress: string;
  collateralAddress: string;
  collateralSymbol: string;
  collateralDecimals: number;
  permitAllowed: boolean;
  hardCap: string;
  interestRate: string;
  borrowRatio: string;
  availableDebt: string;
  currentDebt: string;
  openingFee: string;
  minPartialRepayPercent: string;
  maxDelayBetweenPartialRepay: string;
  minBorrow: string;
  label: string; // WBTC-3%-16666.67
  status: LendingTermStatus;
}

export enum LendingTermStatus {
  LIVE = 'live',
  DEPRECATED = 'deprecated'
}

export interface LendingTermsFileStructure {
  updated: number;
  updatedHuman: string;
  terms: LendingTerm[];
}
