export type LendingTerms = {
  address: string;
  collateral: {
    symbol: string;
    address: string;
    name: string;
    logo: string;
    decimals: number;
  };
  interestRate: number;
  borrowRatio: number;
  availableDebt: number;
  currentDebt: number;
  openingFee: number;
  maxDebtPerCollateralToken: number;
  minPartialRepayPercent: number;
  maxDelayBetweenPartialRepay: number;
  status: 'deprecated' | 'live';
  label: string;
  gaugeWeight: number;
  totalTypeWeight: number;
  issuance: number;
  debtCeiling: number;
  termSurplusBuffer: number;
  activeLoans: number;
};

export interface LendingTermsApiResponse {
  updated: number;
  updatedHuman: string;
  terms: LendingTerms[];
}
