export interface ResultEntry {
  address: string;
  effective_balance: number;
}

export interface EtherfiResponse {
  Result: ResultEntry[];
}
