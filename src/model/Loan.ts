export interface Loan {
  id: string;
  status: LoanStatus;
  borrowerAddress: string;
  lendingTermAddress: string;
  borrowAmount: string;
  collateralAmount: string;
  callerAddress: string;
  callTime: number; // unix timestamp ms
  originationTime: number; // unix timestamp ms
  closeTime: number; // unix timestamp ms
  debtWhenSeized: string;
  bidTime: number; // unix timestamp ms
  lastPartialRepay: number; // unix timestamp ms
}

export enum LoanStatus {
  ACTIVE = 'active',
  CALLED = 'called',
  CLOSED = 'closed'
}

export interface LoansFileStructure {
  updated: number;
  updatedHuman: string;
  loans: Loan[];
}
