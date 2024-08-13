export interface SyncData {
  termSync: TermSyncData[];
  gaugeSync: GaugeSyncData;
  auctionSync: AuctionSyncData[];
  activitySync?: ActivitySyncData;
  proposalSync?: ProposalSyncData;
  proposalParamsSync?: ProposalParamsSyncData;
}

export interface TermSyncData {
  termAddress: string;
  lastBlockFetched: number;
}

export interface ActivitySyncData {
  lastBlockFetched: number;
}

export interface GaugeSyncData {
  lastBlockFetched: number;
}

export interface AuctionSyncData {
  auctionHouseAddress: string;
  lastBlockFetched: number;
}

export interface ProposalSyncData {
  lastBlockFetched: number;
}

export interface ProposalParamsSyncData {
  lastBlockFetched: number;
}
