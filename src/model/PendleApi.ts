export interface PendleSwapResponse {
  transaction: Transaction;
  methodName: string;
  contractCallParamsName: string[];
  data: Data;
}

export interface SwapData {
  swapType: number;
  extRouter: string;
  extCalldata: string;
  needScale: boolean;
}

export interface Data {
  amountTokenOut: string;
  amountSyFeeFromLimit: string;
  amountSyFeeFromMarket: string;
  priceImpact: number;
}

export interface Transaction {
  data: string;
  to: string;
}
