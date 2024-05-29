export interface DexGuruTokensResponse {
  data: DexGuruToken[];
}

export interface DexGuruToken {
  address: string;
  price_usd: number;
}
