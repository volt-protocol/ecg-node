export interface HistoricalData {
  name: string;
  values: { [blocknumber: number]: number }; // dictionary [blocknum]: value
  blockTimes: { [blocknumber: number]: number }; // dictionary [blocknum]: timestamp sec
}
