export interface ConfigFile {
  [marketId: number]: ProtocolConstants;
}

export interface ProtocolConstants {
  PEGTOKEN: string;
  deployBlock: number;
  historicalMinBlock: number;
  guildTokenAddress: string;
  pegTokenAddress: string;
  creditTokenAddress: string;
  profitManagerAddress: string;
  lendingTermOffboardingAddress: string;
  lendingTermOnboardingAddress: string;
  uniswapV2RouterAddress: string;
  gatewayAddress: string;
  psmAddress: string;
  daoGovernorGuildAddress: string;
  daoVetoGuildAddress: string;
  lendingTermFactoryAddress: string;
}

export interface TokenConfig {
  address: string;
  // usefull to get price from true mainnet tokens
  // only used if available
  mainnetAddress?: string;
  symbol: string;
  decimals: number;
  permitAllowed: boolean;
  protocolToken: boolean;
  pendleConfiguration?: PendleConfig;
  dexConfiguration?: DexConfig;
  coingeckoId?: string;
  coincapId?: string;
  openoceanId?: number;
}

export interface DexConfig {
  dex: DexEnum;
  addresses: string[]; // must list pool addresses (if multiple) for token vs USDC/USDT or WETH. For univ3 it's because it exists multiple pools
  viaWETH: boolean; // if true, means the pool is Token/WETH and the price should be multiplied by WETH price
}

export enum DexEnum {
  UNISWAP_V3 = 'UNISWAP_V3'
}

export interface PendleConfig {
  market: string;
  syTokenOut: string;
  ytAddress: string;
  expiry: string;
  basePricingAsset: PendleBasePricingConfig;
}

export interface PendleBasePricingConfig {
  chainId: number;
  symbol: string;
  address: string;
}
