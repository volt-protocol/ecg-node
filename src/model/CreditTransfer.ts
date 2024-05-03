import { DefaultLog } from '../utils/Web3Helper';

export interface CreditTransferFile {
  lastBlockFetched: number;
  creditHolderCount: number;
  transfers: DefaultLog[];
}
