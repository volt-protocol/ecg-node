import { sleep } from '../utils/Utils';

async function UserSlasher() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'USER_SLASHER';
    console.log('UserSlasher');
    await sleep(10000);
    throw new Error('ERROR');
  }
}

UserSlasher();
