export interface OneInchSwapResponse {
  dstAmount: string;
  tx: Tx;
}

export interface Tx {
  from: string;
  to: string;
  data: string;
  value: string;
  gas: number;
  gasPrice: string;
}
