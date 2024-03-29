export default interface LendingTerm {
  termAddress: string;
  collateralAddress: string;
  collateralSymbol: string;
  collateralDecimals: number;
  permitAllowed: boolean;
  hardCap: string;
  interestRate: string;
  borrowRatio: string;
  maxDebtPerCollateralToken: string;
  availableDebt: string;
  currentDebt: string;
  openingFee: string;
  minPartialRepayPercent: string;
  maxDelayBetweenPartialRepay: number; // in seconds
  minBorrow: string;
  label: string; // WBTC-3%-16666.67
  status: LendingTermStatus;
  auctionHouseAddress: string;
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
