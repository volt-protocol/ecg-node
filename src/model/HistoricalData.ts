export interface HistoricalData {
  name: string;
  values: { [blocknumber: number]: number }; // dictionary [blocknum]: value
  blockTimes: { [blocknumber: number]: number }; // dictionary [blocknum]: timestamp sec
}

export interface HistoricalDataMulti {
  name: string;
  values: { [blocknumber: number]: { [valueName: string]: number } }; // dictionary [blocknum]: dictionary [valueName]: value
  blockTimes: { [blocknumber: number]: number }; // dictionary [blocknum]: timestamp sec
}

export interface ApiHistoricalData {
  timestamps: number[];
  values: number[];
}
