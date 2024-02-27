export interface UserSlasherState {
  gauges: { [gaugeAddress: string]: UserSlasherGaugeState };
}

export interface UserSlasherGaugeState {
  users: { [userAddress: string]: UserSlasherUserState };
}

export interface UserSlasherUserState {
  lastCheckedTimestamp: number; // in ms
  failReason: string;
}
