import { ProtocolConstants } from '../model/ProtocolConstants';
import { APP_ENV } from '../utils/Constants';

export const PROTOCOL_CONSTANTS: { [chain: string]: ProtocolConstants } = {
  MAINNET: {
    deployBlock: 0,
    guildTokenAddress: '0x',
    creditTokenAddress: '0x',
    profitManagerAddress: '0x'
  },
  SEPOLIA: {
    deployBlock: 5191505,
    guildTokenAddress: '0x79E2B8553Da5361d90Ed08A9E3F2f3e5E5fF2f8f',
    creditTokenAddress: '0x7dFF544F61b262d7218811f78c94c3b2F4e3DCA1',
    profitManagerAddress: '0x8738C00828C8E6883326EA5Ba104cAcff95808e0'
  }
};

export const TOKENS: TokenConfig[] = [
  {
    address: '0x7b8b4418990e4Daf35F5c7f0165DC487b1963641',
    mainnetAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    symbol: 'USDC',
    decimals: 6,
    permitAllowed: true
  },
  {
    address: '0x1cED1eB530b5E71E6dB9221A22C725e862fC0e60',
    mainnetAddress: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    symbol: 'WBTC',
    decimals: 8,
    permitAllowed: true
  },
  {
    address: '0x9F07498d9f4903B10dB57a3Bd1D91b6B64AEd61e',
    mainnetAddress: '0x83f20f44975d03b1b09e64809b757c47f942beea',
    symbol: 'sDAI',
    decimals: 18,
    permitAllowed: true
  },
  {
    address: '0x7dFF544F61b262d7218811f78c94c3b2F4e3DCA1',
    symbol: 'gUSDC',
    decimals: 18,
    permitAllowed: true
  }
];

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
