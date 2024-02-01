export interface NodeConfig {
  processors: Processors;
}

export interface Processors {
  LOAN_CALLER: ProcessorConfig;
  TERM_OFFBOARDER: TermOffboarderConfig;
  NEW_TERMS_WATCHER: ProcessorConfig;
  USER_SLASHER: ProcessorConfig;
  AUCTION_BIDDER: ProcessorConfig;
  HISTORICAL_DATA_FETCHER: ProcessorConfig;
}

export interface ProcessorConfig {
  enabled: boolean;
}

export interface TermOffboarderConfig extends ProcessorConfig {
  tokens: { [tokenSymbol: string]: TermOffboarderConfigToken };
}

export interface TermOffboarderConfigToken {
  overcollateralization: number;
}
