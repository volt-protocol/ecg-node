import { sleep } from '../utils/Utils';

async function LoanCaller() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'LOAN_CALLER';
    console.log('LoanCaller');
    await sleep(10000);
    throw new Error('ERROR');
  }
}

LoanCaller();
