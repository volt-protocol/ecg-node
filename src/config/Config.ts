import { ProtocolConstants } from '../model/ProtocolConstants';
import { MARKET_ID, TOKENS_FILE, CONFIG_FILE, NETWORK, PENDLE_ORACLES } from '../utils/Constants';
import { readFileSync } from 'fs';
import { HttpGet } from '../utils/HttpHelper';

export interface ConfigFile {
  [marketId: number]: ProtocolConstants;
}

let configuration: ProtocolConstants;
let tokens: TokenConfig[] = [];

export async function LoadConfiguration() {
  await Promise.all([LoadProtocolConstants(), LoadTokens()]);
}

export async function GetFullConfigFile(): Promise<ConfigFile> {
  // Log(`LoadConfiguration: loading protocol data from ${CONFIG_FILE}`);
  if (CONFIG_FILE.startsWith('http')) {
    // load via http
    const resp = await HttpGet<ConfigFile>(CONFIG_FILE);
    return resp;
  } else {
    // read from filesystem
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  }
}

async function LoadProtocolConstants() {
  // Log(`LoadConfiguration: loading protocol data from ${CONFIG_FILE}`);
  if (CONFIG_FILE.startsWith('http')) {
    // load via http
    const resp = await HttpGet<ConfigFile>(CONFIG_FILE);
    configuration = resp[MARKET_ID];
  } else {
    // read from filesystem
    configuration = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))[MARKET_ID];
  }

  if (!configuration) {
    throw new Error(`CANNOT FIND CONFIGURATION FOR MARKET_ID ${MARKET_ID} on file ${CONFIG_FILE}`);
  }
}

async function LoadTokens() {
  // Log(`LoadConfiguration: loading tokens data from ${TOKENS_FILE}`);
  if (TOKENS_FILE.startsWith('http')) {
    // load via http
    tokens = await HttpGet<TokenConfig[]>(TOKENS_FILE);
  } else {
    // read from filesystem
    tokens = JSON.parse(readFileSync(TOKENS_FILE, 'utf-8'));
  }

  if (!tokens || tokens.length == 0) {
    throw new Error(`CANNOT FIND TOKENS CONFIG on file ${TOKENS_FILE}`);
  }
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
  basePricingAsset: PendleBasePricingConfig;
}

export interface PendleBasePricingConfig {
  chainId: number;
  symbol: string;
  address: string;
}
/**
 * Get a token by its symbol, throw if not found
 * @param symbol
 */
export function getTokenBySymbol(symbol: string) {
  const token = tokens.find((_) => _.symbol == symbol);
  if (!token) {
    throw new Error(`Could not find token with symbol: ${symbol}`);
  }

  return token;
}

export function getAllTokens() {
  return tokens;
}

/**
 * Get a token by its address, throw if not found
 * @param symbol
 */
export function getTokenByAddress(address: string) {
  const token = tokens.find((_) => _.address == address);
  if (!token) {
    throw new Error(`Could not find token with address: ${address}`);
  }

  return token;
}

/**
 * Get a token by its address, return undefined if not found
 * @param symbol
 */
export function getTokenByAddressNoError(address: string) {
  return tokens.find((_) => _.address == address);
}

export function GetDeployBlock() {
  if (!configuration.deployBlock || configuration.deployBlock == 0) {
    throw new Error(`'deployBlock' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.deployBlock;
}

export function GetHistoricalMinBlock() {
  if (!configuration.historicalMinBlock || configuration.historicalMinBlock == 0) {
    throw new Error(`'historicalMinBlock' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.historicalMinBlock;
}

export function GetGuildTokenAddress() {
  if (!configuration.guildTokenAddress) {
    throw new Error(`'guildTokenAddress' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.guildTokenAddress;
}

export function GetPegTokenAddress() {
  if (!configuration.pegTokenAddress) {
    throw new Error(`'pegTokenAddress' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.pegTokenAddress;
}

export function GetCreditTokenAddress() {
  if (!configuration.creditTokenAddress) {
    throw new Error(`'creditTokenAddress' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.creditTokenAddress;
}

export function GetProfitManagerAddress() {
  if (!configuration.profitManagerAddress) {
    throw new Error(`'profitManagerAddress' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.profitManagerAddress;
}

export function GetLendingTermOffboardingAddress() {
  if (!configuration.lendingTermOffboardingAddress) {
    throw new Error(`'lendingTermOffboardingAddress' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.lendingTermOffboardingAddress;
}

export function GetLendingTermOnboardingAddress() {
  if (!configuration.lendingTermOnboardingAddress) {
    throw new Error(`'lendingTermOnboardingAddress' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.lendingTermOnboardingAddress;
}

export function GetUniswapV2RouterAddress() {
  if (!configuration.uniswapV2RouterAddress) {
    throw new Error(`'uniswapV2RouterAddress' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.uniswapV2RouterAddress;
}

export function GetGatewayAddress() {
  if (!configuration.gatewayAddress) {
    throw new Error(`'gatewayAddress' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.gatewayAddress;
}

export function GetPSMAddress() {
  if (!configuration.psmAddress) {
    throw new Error(`'psmAddress' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.psmAddress;
}

export function GetDaoGovernorGuildAddress() {
  if (!configuration.daoGovernorGuildAddress) {
    throw new Error(`'daoGovernorGuildAddress' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.daoGovernorGuildAddress;
}

export function GetDaoVetoGuildAddress() {
  if (!configuration.daoVetoGuildAddress) {
    throw new Error(`'daoVetoGuildAddress' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.daoVetoGuildAddress;
}

export function GetLendingTermFactoryAddress() {
  if (!configuration.lendingTermFactoryAddress) {
    throw new Error(`'lendingTermFactoryAddress' not set in configuration ${CONFIG_FILE}`);
  }
  return configuration.lendingTermFactoryAddress;
}

export function GetPendleOracleAddress() {
  const pendleOracle = PENDLE_ORACLES[NETWORK];
  if (!pendleOracle) {
    throw new Error(`Cannot find pendle oracle for network ${NETWORK}`);
  }
  return pendleOracle;
}
