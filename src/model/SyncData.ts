export interface SyncData {
  termSync: TermSyncData[];
}

export interface TermSyncData {
  termAddress: string;
  lastBlockFetched: number;
}
