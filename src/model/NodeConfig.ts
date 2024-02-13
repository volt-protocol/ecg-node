export interface NodeConfig {
  processors: Processors;
}

export interface Processors {
  LOAN_CALLER: ProcessorConfig;
  TERM_OFFBOARDER: TermOffboarderConfig;
  NEW_TERMS_WATCHER: ProcessorConfig;
  USER_SLASHER: ProcessorConfig;
  AUCTION_BIDDER: AuctionBidderConfig;
  TESTNET_MARKET_MAKER: TestnetMarketMakerConfig;
  HISTORICAL_DATA_FETCHER: ProcessorConfig;
}

export interface ProcessorConfig {
  enabled: boolean;
}

export interface TermOffboarderConfig extends ProcessorConfig {
  tokens: { [tokenSymbol: string]: TermOffboarderConfigToken };
}

export interface TermOffboarderConfigToken {
  minOvercollateralization: number;
}

export interface AuctionBidderConfig extends ProcessorConfig {
  minProfitUsdc: number;
  enableForgive: boolean;
}

export interface TestnetMarketMakerConfig extends ProcessorConfig {
  threshold: number;
  uniswapPairs: MMUniswapPairConfig[];
}

export interface MMUniswapPairConfig {
  path: string[];
  poolAddress: string;
  targetRatio: number;
}
