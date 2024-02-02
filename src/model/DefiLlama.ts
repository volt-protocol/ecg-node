export interface DefiLlamaPriceResponse {
  coins: {
    [tokenId: string]: DefiLlamaPriceData;
  };
}

export interface DefiLlamaPriceData {
  decimals: number;
  symbol: string;
  price: number;
  timestamp: number;
  confidence: number;
}
