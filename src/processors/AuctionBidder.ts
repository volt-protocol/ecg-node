import { sleep } from '../utils/Utils';

const RUN_EVERY_SEC = 15;

async function AuctionBidder() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'AUCTION_BIDDER';
    console.log('AuctionBidder: starting');

    await sleep(15 * 1000);
  }
}

AuctionBidder();
