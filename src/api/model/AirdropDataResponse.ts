export interface AirdropDataResponse {
  rebasingSupplyUsd: number;
  totalIssuanceUsd: number;
  termSurplusBufferUsd: number;
  marketUtilization: { [marketId: number]: number };
  marketTVL: { [marketId: number]: number };
  marketDebt: { [marketId: number]: number };
}
