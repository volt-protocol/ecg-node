export interface Loan {
  id: string;
  borrower: string;
  borrowRatio: number;
  borrowAmount: number;
  borrowTime: number;
  collateral: string;
  borrowCreditMultiplier: number;
  callDebt: number;
  callTime: number;
  closeTime: number;
  collateralAmount: number;
  interestRate: number;
  txHashOpen: string;
  txHashClose: string;
  termAddress: string;
  loanDebt: number;
}

export enum LoanStatus {
  ACTIVE = 'active',
  CALLED = 'called',
  CLOSED = 'closed'
}

export interface LoansApiResponse {
  updated: number;
  updatedHuman: string;
  loans: Loan[];
}
