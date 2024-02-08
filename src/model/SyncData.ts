export interface SyncData {
  termSync: TermSyncData[];
  auctionSync: AuctionSyncData[];
}

export interface TermSyncData {
  termAddress: string;
  lastBlockFetched: number;
}

export interface AuctionSyncData {
  auctionHouseAddress: string;
  lastBlockFetched: number;
}
