export interface Auction {
  loanId: string;
  auctionHouseAddress: string;
  lendingTermAddress: string;
  collateralTokenAddress: string;
  status: AuctionStatus;
  startTime: number; // unix ms
  endTime: number; // unix ms
  collateralAmount: string;
  callDebt: string;
  callCreditMultiplier: string;
  collateralSold: string;
  debtRecovered: string;
  bidTxHash: string;
}

export enum AuctionStatus {
  ACTIVE = 'active',
  CLOSED = 'closed'
}

export interface AuctionsFileStructure {
  updated: number;
  updateBlock: number;
  updatedHuman: string;
  auctions: Auction[];
}
