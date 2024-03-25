import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

export const ECG_NODE_CONFIG_FULL_FILENAME =
  process.env.ECG_NODE_FULL_FILENAME || path.join(process.cwd(), 'ecg-node-config.json');

export const APP_ENV = process.env.APP_ENV || 'SEPOLIA';
export const MARKET_ID = process.env.MARKET_ID ? Number(process.env.MARKET_ID) : 1;
export const DATA_DIR = path.join(process.cwd(), 'data', `market_${MARKET_ID}`);
export const CONFIG_FILE =
  process.env.CONFIG_FILE ||
  `https://raw.githubusercontent.com/volt-protocol/ecg-node/main/params/protocol-config.${APP_ENV}.json`;
export const TOKENS_FILE =
  process.env.TOKENS_FILE ||
  `https://raw.githubusercontent.com/volt-protocol/ecg-node/main/params/tokens.${APP_ENV}.json`;

export const EXPLORER_URI = process.env.EXPLORER_URI || 'https://etherscan.io';
