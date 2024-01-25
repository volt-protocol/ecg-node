import { sleep } from '../utils/Utils';

async function NewTermsWatcher() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'NEW_TERMS_WATCHER';
    console.log('NewTermsWatcher');
    await sleep(10000);
    throw new Error('ERROR');
  }
}

NewTermsWatcher();
