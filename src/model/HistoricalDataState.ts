export interface HistoricalDataStateLoanBorrow {
  openLoans: { [termAddress: string]: string[] }; // termAddress => loanId[]
}
