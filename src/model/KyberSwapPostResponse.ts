export interface KyberSwapPostResponse {
  code: number;
  message: string;
  data: Data;
  requestId: string;
}

export interface Data {
  amountIn: string;
  amountInUsd: string;
  amountOut: string;
  amountOutUsd: string;
  gas: string;
  gasUsd: string;
  additionalCostUsd: string;
  additionalCostMessage: string;
  outputChange: OutputChange;
  data: string;
  routerAddress: string;
}

export interface OutputChange {
  amount: string;
  percent: number;
  level: number;
}
