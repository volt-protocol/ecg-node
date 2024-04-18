export interface HistoricalDataState {
  openLoans: { [termAddress: string]: string[] }; // termAddress => loanId[]
  lastBlockActivityFetched: number;
}
