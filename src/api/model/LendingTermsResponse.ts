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
};

export interface LendingTermsApiResponse {
  updated: number;
  updatedHuman: string;
  terms: LendingTerms[];
}
