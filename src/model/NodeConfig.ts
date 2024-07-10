export interface NodeConfig {
  processors: Processors;
}

export interface Processors {
  LOAN_CALLER: ProcessorConfig;
  TERM_OFFBOARDER: TermOffboarderConfig;
  TERM_ONBOARDING_WATCHER: ProcessorConfig;
  USER_SLASHER: UserSlasherConfig;
  AUCTION_BIDDER: AuctionBidderConfig;
  TESTNET_MARKET_MAKER: TestnetMarketMakerConfig;
  HISTORICAL_DATA_FETCHER: ProcessorConfig;
}

export interface ProcessorConfig {
  enabled: boolean;
}

export interface TermOffboarderConfig extends ProcessorConfig {
  performCleanup?: boolean; // default to false
  defaultMinOvercollateralization: number;
  onlyLogging?: boolean; // default to false
  tokens: { [tokenSymbol: string]: TermOffboarderConfigToken };
}

export interface UserSlasherConfig extends ProcessorConfig {
  minSizeToSlash: number;
}

export interface TermOffboarderConfigToken {
  defaultMinOvercollateralization: number;
  doNotOffboardCollateral?: boolean;
  auctionDurationSpecifics: { maxMidpointDuration: number; minOvercollateralization: number }[];
}

export interface AuctionBidderConfig extends ProcessorConfig {
  minProfitUsd: number;
  enableForgive: boolean;
}

export enum BidderSwapMode {
  UNISWAPV2 = 'UNISWAPV2',
  ONE_INCH = '1INCH',
  OPEN_OCEAN = 'OPEN_OCEAN'
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
