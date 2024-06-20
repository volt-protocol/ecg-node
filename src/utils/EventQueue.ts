import { Log, Result } from 'ethers';

export const EventQueue: EventData[] = [];

export interface EventData {
  txHash: string;
  sourceAddress?: string;
  sourceContract: string;
  eventName: string;
  block: number;
  originArgs: Result;
  originArgName: string[];
}


export const EventQueueV2: EventDataV2[] = [];

export interface EventDataV2 {
  txHash: string;
  sourceAddress?: string;
  sourceContract: string;
  log: Log;
}