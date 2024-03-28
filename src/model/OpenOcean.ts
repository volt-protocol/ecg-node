export interface OpenOceanSwapQuote {
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
