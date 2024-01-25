import { ethers } from 'ethers';

/**
 * Normalize a token amount to its decimal value
 * @param amount amount string or bigint
 * @param decimals default to 18
 * @returns
 */
export function norm(amount: bigint | string | number, decimals = 18) {
  return Number(ethers.formatUnits(amount, decimals));
}
