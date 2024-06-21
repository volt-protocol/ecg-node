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

// this is used by the new universal watcher
export const EventQueueV2: EventDataV2[] = [];

export interface EventDataV2 {
  block: number;
  txHash: string;
  sourceAddress: string;
  sourceContract: SourceContractEnum;
  log: Log;
}

export enum SourceContractEnum {
  UNK = 'UNKNOWN',
  GUILD = 'GUILD',
  TERM = 'TERM',
  TERM_ONBOARDING = 'TERM_ONBOARDING',
  TERM_FACTORY = 'TERM_FACTORY'
}
