import { ProtocolConstants } from '../model/ProtocolConstants';
import { APP_ENV } from '../utils/Constants';

export const TOKENS: TokenConfig[] = [
  {
    address: '0xe9248437489bC542c68aC90E178f6Ca3699C3F6b',
    symbol: 'USDC',
    decimals: 6,
    permitAllowed: true
  },
  {
    address: '0xCfFBA3A25c3cC99A05443163C63209972bfFd1C1',
    symbol: 'WBTC',
    decimals: 8,
    permitAllowed: true
  },
  {
    address: '0xeeF0AB67262046d5bED00CE9C447e08D92b8dA61',
    symbol: 'sDAI',
    decimals: 18,
    permitAllowed: true
  },
  {
    address: '0x33b79F707C137AD8b70FA27d63847254CF4cF80f',
    symbol: 'gUSDC',
    decimals: 18,
    permitAllowed: true
  }
];

export interface TokenConfig {
  address: string;
  symbol: string;
  decimals: number;
  permitAllowed: boolean;
}

/**
 * Get a token by its symbol, throw if not found
 * @param symbol
 */
export function getTokenBySymbol(symbol: string) {
  const token = TOKENS.find((_) => _.symbol == symbol);
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
  const token = TOKENS.find((_) => _.address == address);
  if (!token) {
    throw new Error(`Could not find token with address: ${address}`);
  }

  return token;
}

export const PROTOCOL_CONSTANTS: { [chain: string]: ProtocolConstants } = {
  MAINNET: {
    deployBlock: 0,
    guildTokenAddress: '0x',
    creditTokenAddress: '0x',
    profitManagerAddress: '0x'
  },
  SEPOLIA: {
    deployBlock: 4835102,
    guildTokenAddress: '0xcc65D0FeAa7568b70453c26648e8A7bbEF7248B4',
    creditTokenAddress: '0x33b79F707C137AD8b70FA27d63847254CF4cF80f',
    profitManagerAddress: '0xD8c5748984d27Af2b1FC8235848B16C326e1F6de'
  }
};

export function GetDeployBlock() {
  return PROTOCOL_CONSTANTS[APP_ENV].deployBlock;
}

export function GetGuildTokenAddress() {
  return PROTOCOL_CONSTANTS[APP_ENV].guildTokenAddress;
}

export function GetCreditTokenAddress() {
  return PROTOCOL_CONSTANTS[APP_ENV].creditTokenAddress;
}
export function GetProfitManagerAddress() {
  return PROTOCOL_CONSTANTS[APP_ENV].profitManagerAddress;
}
