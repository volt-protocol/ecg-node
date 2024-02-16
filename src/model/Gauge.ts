export interface Gauge {
  address: string;
  weight: string;
  lastLoss: number; // unix timestamp ms
  users: GaugeUser[];
}

export interface GaugeUser {
  address: string;
  weight: string;
  lastLossApplied: number; // unix timestamp ms
}

export interface GaugesFileStructure {
  updated: number;
  updatedHuman: string;
  gauges: Gauge[];
}
