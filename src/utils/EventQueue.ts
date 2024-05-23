import { Result } from 'ethers';

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
