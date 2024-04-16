import { ProtocolConstants } from '../model/ProtocolConstants';
import { MARKET_ID, TOKENS_FILE, CONFIG_FILE } from '../utils/Constants';
import { readFileSync } from 'fs';
import { HttpGet } from '../utils/HttpHelper';

interface ConfigFile {
  [marketId: number]: ProtocolConstants;
}

let configuration: ProtocolConstants;
let tokens: TokenConfig[] = [];

export async function LoadConfiguration() {
  await Promise.all([LoadProtocolConstants(), LoadTokens()]);
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
  pendleConfiguration?: PendleConfig;
}

export interface PendleConfig {
  market: string;
  syTokenOut: string;
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

export function GetDeployBlock() {
  return configuration.deployBlock;
}

export function GetGuildTokenAddress() {
  return configuration.guildTokenAddress;
}

export function GetPegTokenAddress() {
  return configuration.pegTokenAddress;
}

export function GetCreditTokenAddress() {
  return configuration.creditTokenAddress;
}

export function GetProfitManagerAddress() {
  return configuration.profitManagerAddress;
}

export function GetLendingTermOffboardingAddress() {
  return configuration.lendingTermOffboardingAddress;
}

export function GetLendingTermOnboardingAddress() {
  return configuration.lendingTermOnboardingAddress;
}

export function GetUniswapV2RouterAddress() {
  return configuration.uniswapV2RouterAddress;
}

export function GetGatewayAddress() {
  return configuration.gatewayAddress;
}

export function GetPSMAddress() {
  return configuration.psmAddress;
}

export function GetDaoGovernorGuildAddress() {
  return configuration.daoGovernorGuildAddress;
}

export function GetDaoVetoGuildAddress() {
  return configuration.daoVetoGuildAddress;
}
