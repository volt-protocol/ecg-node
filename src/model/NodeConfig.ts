export interface NodeConfig {
  processors: Processors;
}

export interface Processors {
  LOAN_CALLER: ProcessorConfig;
  TERM_OFFBOARDER: ProcessorConfig;
  NEW_TERMS_WATCHER: ProcessorConfig;
  USER_SLASHER: ProcessorConfig;
  AUCTION_BIDDER: ProcessorConfig;
  HISTORICAL_DATA_FETCHER: ProcessorConfig;
}

export interface ProcessorConfig {
  enabled: boolean;
}
