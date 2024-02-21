export interface ProtocolData {
  creditMultiplier: bigint;
}

export interface ProtocolDataFileStructure {
  updated: number;
  updatedHuman: string;
  data: ProtocolData;
}
