import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './Constants';
import { sleep } from './Utils';
import { SendNotifications } from './Notifications';
import logger from './Logger';

const lockFile = path.join(DATA_DIR, 'data.lock');

export class FileMutex {
  static async WaitForUnlock() {
    let isLocked = true;
    const dtStart = Date.now();
    while (isLocked) {
      const waitDuration = Date.now() - dtStart;
      if (fs.existsSync(lockFile)) {
        const lockedMsg = fs.readFileSync(lockFile, 'utf-8');
        if (lockedMsg.startsWith('LOCKED')) {
          // do not lock is already locked by same process
          // this can happen when killing process too harshly
          if (lockedMsg == `LOCKED BY ${process.title}`) {
            isLocked = false;
          } else {
            logger.debug(`WaitForUnlock: ${lockedMsg}`);
            if (waitDuration > 15 * 60 * 1000) {
              // if more than 10 min wait, notify and throw
              await SendNotifications('FileMutex', 'Timeout', `WaitForUnlock: timeout waiting on ${lockedMsg}`);
              throw new Error(`WaitForUnlock: timeout waiting on ${lockedMsg}`);
            }
            await sleep(1000);
          }
        } else {
          isLocked = false;
        }
      } else {
        isLocked = false;
      }
    }
  }

  static async Lock() {
    await FileMutex.WaitForUnlock();
    fs.writeFileSync(lockFile, `LOCKED BY ${process.title}`);
  }

  static async Unlock() {
    if (fs.readFileSync(lockFile, 'utf-8') == `LOCKED BY ${process.title}`) {
      fs.writeFileSync(lockFile, 'UNLOCKED');
    }
  }
}
