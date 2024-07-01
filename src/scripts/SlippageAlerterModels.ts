import { TokenConfig } from '../model/Config';

export interface LastRunData {
  lastRecapMsgSentMs: number; // timestamp ms
  slippageAlertSentPerToken: { [tokenSymbol: string]: number }; // timestamp ms
}

export interface CollateralData {
  totalAmount: number;
  tokenInfo: TokenConfig;
  tokenPrice: number;
  nbLoans: number;
}

export interface PerMarketCollateralData {
  totalAmount: number;
  totalDebtPegToken: number;
  pegTokenPrice: number;
  tokenInfo: TokenConfig;
  tokenPrice: number;
  nbLoans: number;
}

export interface PerMarketResult extends PerMarketCollateralData {
  marketId: number;
  collateralAmountUsd: number;
  soldAmountPegToken: number;
  debtAmountUsd: number;
  slippage: number;
  overCollateralizationWithSlippage: number;
  pegTokenInfo: TokenConfig;
  errorMsg?: string;
}
