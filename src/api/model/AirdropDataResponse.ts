export interface AirdropDataResponse {
  rebasingSupplyUsd: number;
  totalIssuanceUsd: number;
  termSurplusBufferUsd: number;
  marketUtilization: { [marketId: number]: number };
}
