import path from 'path';

export const DATA_DIR = process.cwd();

export const ECG_NODE_CONFIG_FULL_FILENAME =
  process.env.ECG_NODE_FULL_FILENAME || path.join(process.cwd(), 'ecg-node-config.json');
