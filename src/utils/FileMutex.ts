import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './Constants';
import { sleep } from './Utils';

const lockFile = path.join(DATA_DIR, 'data.lock');

export class FileMutex {
  static async WaitForUnlock() {
    let isLocked = true;
    while (isLocked) {
      if (fs.existsSync(lockFile)) {
        const lockedMsg = fs.readFileSync(lockFile, 'utf-8');
        if (lockedMsg.startsWith('LOCKED')) {
          if (lockedMsg == `LOCKED BY ${process.title}`) {
            isLocked = false;
          } else {
            console.log(`WaitForUnlock: ${lockedMsg}`);
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
