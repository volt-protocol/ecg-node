export interface OpenOceanSwapQuoteResponse {
  code: number;
  data: Data;
}

export interface Data {
  chainId: number;
  inToken: Token;
  outToken: Token;
  inAmount: string;
  outAmount: string;
  estimatedGas: number;
  minOutAmount: string;
  from: string;
  to: string;
  value: string;
  gasPrice: string;
  data: string;
  gmxFee: string;
}

export interface Token {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
}

export function GetOpenOceanChainCodeByChainId(chainId: bigint) {
  switch (chainId) {
    default:
      throw new Error(`GetOpenOceanChainCodeByChainId: Unknown chain code: ${chainId}`);
    case 1n:
      return 'eth';
    case 137n:
      return 'polygon';
    case 42161n:
      return 'arbitrum';
  }
}

export interface TokenListResponse {
  data: TokenListToken[];
}

export interface TokenListToken {
  id: number;
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  usd: string;
}
