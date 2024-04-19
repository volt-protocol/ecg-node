export default interface LendingTerm {
  termAddress: string;
  collateralAddress: string;
  collateralSymbol: string;
  collateralDecimals: number;
  permitAllowed: boolean;
  hardCap: string;
  interestRate: string;
  maxDebtPerCollateralToken: string; // in pegToken with (36-collateral decimals) decimals
  availableDebt: string;
  currentDebt: string;
  openingFee: string;
  minPartialRepayPercent: string;
  maxDelayBetweenPartialRepay: number; // in seconds
  minBorrow: string;
  label: string; // WBTC-3%-16666.67
  status: LendingTermStatus;
  auctionHouseAddress: string;
  gaugeWeight: string;
  totalWeightForMarket: string;
  issuance: string;
  debtCeiling: string;
  termSurplusBuffer: string;
}

export enum LendingTermStatus {
  LIVE = 'live',
  DEPRECATED = 'deprecated'
}

export interface LendingTermsFileStructure {
  updated: number;
  updateBlock: number;
  updatedHuman: string;
  terms: LendingTerm[];
}
