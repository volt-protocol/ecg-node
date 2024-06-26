import { PendleConfig } from '../../model/Config';

export interface TokensApiInfo {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
  price: number;
  pendleConfig?: PendleConfig;
}
