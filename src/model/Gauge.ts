export interface Gauge {
  address: string;
  weight: bigint;
  lastLoss: number; // unix timestamp ms
  users: { [userAddress: string]: GaugeUser };
}

export interface GaugeUser {
  address: string;
  weight: bigint;
  lastLossApplied: number; // unix timestamp ms
}

export interface GaugesFileStructure {
  updated: number;
  updatedHuman: string;
  gauges: { [gaugeAddress: string]: Gauge };
}
