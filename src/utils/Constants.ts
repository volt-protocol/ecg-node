import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

export const ECG_NODE_CONFIG_FULL_FILENAME =
  process.env.ECG_NODE_FULL_FILENAME || path.join(process.cwd(), 'ecg-node-config.json');

export const NETWORK = process.env.NETWORK || 'SEPOLIA';

export const MARKET_ID = process.env.MARKET_ID ? Number(process.env.MARKET_ID) : 1;
export const GLOBAL_DATA_DIR = path.join(process.cwd(), 'data');
export const DATA_DIR = path.join(GLOBAL_DATA_DIR, `market_${MARKET_ID}`);
export const CONFIG_FILE =
  process.env.CONFIG_FILE ||
  `https://raw.githubusercontent.com/volt-protocol/ecg-node/main/params/protocol-config.${NETWORK}.json`;
export const TOKENS_FILE =
  process.env.TOKENS_FILE ||
  `https://raw.githubusercontent.com/volt-protocol/ecg-node/main/params/tokens.${NETWORK}.json`;

export const EXPLORER_URI = process.env.EXPLORER_URI || 'https://etherscan.io';

export const BLOCK_PER_HOUR = NETWORK == 'ARBITRUM' ? 14400 : 300;

export const PENDLE_ORACLES: { [network: string]: string } = {
  ETHEREUM: '0x66a1096C6366b2529274dF4f5D8247827fe4CEA8',
  ARBITRUM: '0x1Fd95db7B7C0067De8D45C0cb35D59796adfD187'
};
