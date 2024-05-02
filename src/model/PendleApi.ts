export interface PendleSwapResponse {
  transaction: Transaction;
  methodName: string;
  contractCallParamsName: string[];
  data: Data;
}

export interface SwapData {
  swapType: number;
  extRouter: string;
  extCalldata: string;
  needScale: boolean;
}

export interface Data {
  amountTokenOut: string;
  amountSyFeeFromLimit: string;
  amountSyFeeFromMarket: string;
  priceImpact: number;
}

export interface Transaction {
  data: string;
  to: string;
}

export interface PendleMarketResponse {
  id: string;
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  expiry: Date;
  pt: Lp;
  yt: Lp;
  sy: Lp;
  lp: Lp;
  accountingAsset: AccountingAsset;
  underlyingAsset: AccountingAsset;
  basePricingAsset: AccountingAsset;
  rewardTokens: any[];
  inputTokens: AccountingAsset[];
  outputTokens: AccountingAsset[];
  protocol: string;
  underlyingPool: string;
  simpleName: string;
  simpleSymbol: string;
  simpleIcon: string;
  proName: string;
  proSymbol: string;
  proIcon: string;
  farmName: string;
  farmSymbol: string;
  farmSimpleName: string;
  farmSimpleSymbol: string;
  farmSimpleIcon: string;
  farmProName: string;
  farmProSymbol: string;
  farmProIcon: string;
  assetRepresentation: string;
  isWhitelistedPro: boolean;
  isWhitelistedSimple: boolean;
  votable: boolean;
  isActive: boolean;
  isWhitelistedLimitOrder: boolean;
  accentColor: string;
  totalPt: number;
  totalSy: number;
  totalLp: number;
  totalActiveSupply: number;
  liquidity: { [key: string]: number };
  tradingVolume: TradingVolume;
  underlyingInterestApy: number;
  underlyingRewardApy: number;
  underlyingRewardApyBreakdown: any[];
  underlyingApy: number;
  impliedApy: number;
  ytFloatingApy: number;
  ptDiscount: number;
  swapFeeApy: number;
  pendleApy: number;
  arbApy: number;
  aggregatedApy: number;
  maxBoostedApy: number;
  lpRewardApy: number;
  voterApy: number;
  estimatedDailyPoolRewards: EstimatedDailyPoolReward[];
  dataUpdatedAt: Date;
  liquidityChange24h: number;
  tradingVolumeChange24h: number;
  underlyingInterestApyChange24h: number;
  underlyingApyChange24h: number;
  impliedApyChange24h: number;
  ytFloatingApyChange24h: number;
  ptDiscountChange24h: number;
  swapFeeApyChange24h: number;
  pendleApyChange24h: number;
  aggregatedApyChange24h: number;
  voterApyChange24h: number;
  categoryIds: string[];
  timestamp: Date;
  scalarRoot: number;
  initialAnchor: number;
}

export interface AccountingAsset {
  id: string;
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  expiry: null;
  accentColor: string;
  price: TradingVolume;
  priceUpdatedAt: Date;
  baseType: string;
  types: string[];
  protocol: string;
  simpleName: string;
  simpleSymbol: string;
  simpleIcon: string;
  proName: string;
  proSymbol: string;
  proIcon: string;
  zappable: boolean;
}

export interface TradingVolume {
  usd: number;
}

export interface EstimatedDailyPoolReward {
  asset: Asset;
  amount: number;
}

export interface Asset {
  id: string;
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  accentColor: null;
  price: TradingVolume;
  priceUpdatedAt: Date;
}

export interface Lp {
  id: string;
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  expiry: Date | null;
  accentColor: string;
  price: { [key: string]: number };
  priceUpdatedAt: Date;
  baseType: string;
  types: string[];
  protocol: string;
  underlyingPool: string;
  simpleName: string;
  simpleSymbol: string;
  simpleIcon: string;
  proName: string;
  proSymbol: string;
  proIcon: string;
  zappable: boolean;
}
