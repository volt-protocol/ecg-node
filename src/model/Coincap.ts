export interface CoincapAssetsResponse {
  data: CoincapAsset[];
}

interface CoincapAsset {
  id: string;
  priceUsd: string;
}
