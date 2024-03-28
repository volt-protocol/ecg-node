import axios from 'axios';
import { ProtocolConstants } from '../model/ProtocolConstants';
import { MARKET_ID, TOKENS_FILE, CONFIG_FILE } from '../utils/Constants';
import { readFileSync } from 'fs';
import { Log } from '../utils/Logger';

let configuration: ProtocolConstants;
let tokens: TokenConfig[] = [];

export async function LoadConfiguration() {
  await Promise.all([LoadProtocolConstants(), LoadTokens()]);
}

async function LoadProtocolConstants() {
  // Log(`LoadConfiguration: loading protocol data from ${CONFIG_FILE}`);
  if (CONFIG_FILE.startsWith('http')) {
    // load via axios
    const resp = await axios.get(CONFIG_FILE);
    configuration = resp.data[MARKET_ID];
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
    // load via axios
    const resp = await axios.get(TOKENS_FILE);
    tokens = resp.data;
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
  // only used is APP_ENV != mainnet
  mainnetAddress?: string;
  symbol: string;
  decimals: number;
  permitAllowed: boolean;
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
