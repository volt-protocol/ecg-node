import { readdirSync } from 'fs';
import { GLOBAL_DATA_DIR } from './Constants';
import path from 'path';

/**
 * Get all the submarket directories (in full path)
 * @returns directories full paths of all markets
 */
export function GetMarketsDirectories() {
  return readdirSync(GLOBAL_DATA_DIR)
    .filter((_) => _.startsWith('market_'))
    .map((_) => path.join(GLOBAL_DATA_DIR, _));
}
