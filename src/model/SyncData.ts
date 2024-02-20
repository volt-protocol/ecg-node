export interface SyncData {
  termSync: TermSyncData[];
  gaugeSync: GaugeSyncData;
  auctionSync: AuctionSyncData[];
}

export interface TermSyncData {
  termAddress: string;
  lastBlockFetched: number;
}

export interface GaugeSyncData {
  lastBlockFetched: number;
}

export interface AuctionSyncData {
  auctionHouseAddress: string;
  lastBlockFetched: number;
}
