import { existsSync, readFileSync } from 'fs';
import LendingTerm, { LendingTermsFileStructure } from '../model/LendingTerm';
import { GetNodeConfig, WaitUntilScheduled, sleep } from '../utils/Utils';
import path from 'path';
import { DATA_DIR } from '../utils/Constants';
import { GetTokenPrice } from '../utils/Price';
import { getTokenByAddress } from '../config/Config';
import { norm } from '../utils/TokenUtils';
import { TermOffboarderConfig } from '../model/NodeConfig';

const RUN_EVERY_SEC = 60 * 5;
TermOffboarder();

async function TermOffboarder() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const startDate = Date.now();
    const offboarderConfig = GetNodeConfig().processors.TERM_OFFBOARDER;

    process.title = 'TERM_OFFBOARDER';
    console.log('TermOffboarder: starting');
    const termsFilename = path.join(DATA_DIR, 'terms.json');
    if (!existsSync(termsFilename)) {
      throw new Error('Cannot start TERM OFFBOARDER without terms file. please sync protocol data');
    }
    const termFileData: LendingTermsFileStructure = JSON.parse(readFileSync(termsFilename, 'utf-8'));
    for (const term of termFileData.terms) {
      const termMustBeOffboarded = await checkTermForOffboard(term, offboarderConfig);
      if (termMustBeOffboarded) {
        console.log(`TermOffboarder[${term.label}]: TERM NEEDS TO BE OFFBOARDED`);
      } else {
        console.log(`TermOffboarder[${term.label}]: Term is healthy`);
      }
    }
    console.log('TermOffboarder: Ending');

    await WaitUntilScheduled(startDate, RUN_EVERY_SEC);
  }
}

async function checkTermForOffboard(term: LendingTerm, offboarderConfig: TermOffboarderConfig) {
  const collateralToken = getTokenByAddress(term.collateralAddress);
  const collateralRealPrice = await GetTokenPrice(collateralToken.mainnetAddress || collateralToken.address);
  console.log(`TermOffboarder[${term.label}]: ${collateralToken.symbol} price: ${collateralRealPrice}`);
  const normBorrowRatio = norm(term.borrowRatio);
  console.log(`TermOffboarder[${term.label}]: borrow ratio: ${normBorrowRatio} / ${collateralToken.symbol}`);

  // find the overcollateralization config for this token
  let tokenConfig = offboarderConfig.tokens[collateralToken.symbol];
  if (!tokenConfig) {
    console.warn(`TermOffboarder: Cannot find ${collateralToken.symbol} in offboarder config`);
    tokenConfig = {
      overcollateralization: 1.2
    };
  }
  console.log(`TermOffboarder[${term.label}]: overcollateralization: ${tokenConfig.overcollateralization}`);

  if (collateralRealPrice < normBorrowRatio * tokenConfig.overcollateralization) {
    return true;
  } else {
    return false;
  }
}
