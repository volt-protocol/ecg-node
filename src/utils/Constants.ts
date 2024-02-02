import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

export const DATA_DIR = path.join(process.cwd(), 'data');

export const ECG_NODE_CONFIG_FULL_FILENAME =
  process.env.ECG_NODE_FULL_FILENAME || path.join(process.cwd(), 'ecg-node-config.json');

export const APP_ENV = process.env.APP_ENV || 'MAINNET';

export const EXPLORER_URI = process.env.EXPLORER_URI || 'https://etherscan.io';
