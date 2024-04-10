export interface Auction {
  loanId: string;
  auctionHouseAddress: string;
  lendingTermAddress: string;
  status: AuctionStatus;
  startTime: number; // unix ms
  endTime: number; // unix ms
  collateralAmount: string;
  callDebt: string;
  callCreditMultiplier: string;
  collateralTokenAddress: string;
  collateralSold: string;
  debtRecovered: string;
  bidTxHash: string;
}

export interface AuctionHouse {
  address: string;
  midPoint: number;
  duration: number;
}

export enum AuctionStatus {
  ACTIVE = 'active',
  CLOSED = 'closed'
}

export interface AuctionsApiReponse {
  updated: number;
  updatedHuman: string;
  auctions: Auction[];
  auctionHouses: AuctionHouse[];
}
