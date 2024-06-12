import { ethers } from 'ethers';
import { roundTo } from './Utils';

/**
 * Normalize a token amount to its decimal value
 * @param amount amount string or bigint
 * @param decimals default to 18
 * @returns
 */
export function norm(amount: bigint | string | number, decimals = 18) {
  return Number(ethers.formatUnits(amount, decimals));
}

export function formatCurrencyValue(num: number): string {
  if (isNaN(num)) {
    return '';
  }

  if (num == 0) {
    return '0';
  }

  if (num >= 1e9) {
    return `${roundTo(num / 1e9, 2)}B`;
  } else if (num >= 1e6) {
    return `${roundTo(num / 1e6, 2)}M`;
  } else if (num >= 1e3) {
    return `${roundTo(num / 1e3, 2)}K`;
  } else if (num < 1 / 1e3) {
    return num.toExponential();
  } else {
    return `${roundTo(num, 2).toString()}`;
  }
}
