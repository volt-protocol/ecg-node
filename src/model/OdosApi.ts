export interface OdosQuoteResponse {
  inTokens: string[];
  outTokens: string[];
  inAmounts: string[];
  outAmounts: string[];
  gasEstimate: number;
  dataGasEstimate: number;
  gweiPerGas: number;
  gasEstimateValue: number;
  inValues: number[];
  outValues: number[];
  netOutValue: number;
  priceImpact: number;
  percentDiff: number;
  partnerFeePercent: number;
  pathId: string;
  pathViz: null;
  blockNumber: number;
}

export interface OdosQuoteAssemble {
  deprecated: null;
  blockNumber: number;
  gasEstimate: number;
  gasEstimateValue: number;
  inputTokens: PutToken[];
  outputTokens: PutToken[];
  netOutValue: number;
  outValues: string[];
  transaction: Transaction;
  simulation: null;
}

interface PutToken {
  tokenAddress: string;
  amount: string;
}

interface Transaction {
  gas: number;
  gasPrice: number;
  value: string;
  to: string;
  from: string;
  data: string;
  nonce: number;
  chainId: number;
}
