export interface LastActivity {
  termAddress: string;
  userAddress: string;
  category: string;
  type: string;
  block: number;
  description: string;
  amountIn: number;
  amountOut: number;
  vote: string;
  txHash: string;
  txHashOpen: string;
  txHashClose: string;
}

export interface LastActivityFileStructure {
  updated: number;
  updatedHuman: string;
  activities: LastActivity[];
}
