import { sleep } from '../utils/Utils';

async function TermOffboarder() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'TERM_OFFBOARDER';
    console.log('TermOffboarder');
    await sleep(10000);
    throw new Error('ERROR');
  }
}

TermOffboarder();
