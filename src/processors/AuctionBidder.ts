import { sleep } from '../utils/Utils';

async function AuctionBidder() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'AUCTION_BIDDER';
    console.log('AuctionBidder');
    await sleep(10000);
    throw new Error('ERROR');
  }
}

AuctionBidder();
