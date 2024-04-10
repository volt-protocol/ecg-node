export interface AuctionHouseData {
  address: string;
  midPoint: number;
  duration: number;
}

export interface AuctionHousesFileStructure {
  updated: number;
  updatedHuman: string;
  auctionHouses: AuctionHouseData[];
}
