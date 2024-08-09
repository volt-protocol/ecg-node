# Processors

The processors are like features that you can enable or disable from running on your node deployment.

They're launched in separate processes and are all more or less using the protocol data (stored in the `.json` files of the `./data` directory)

Each processor is very specific and aims to be as small as possible to be as simple as possible. The general goal of the processors is to maintain the credit guild healthy by monitoring collateral token prices, loan repayments, auctions, etc...

As an ECG-Node user, you might want to activate or not a list of processors so that it fits your needs as a protocol safe keeper.

Most of the processors are in a loop, running and waiting again and again. Some are restarted more often than others. You will see that in the detailed documentation.

## Code

Each processor is a self startable typescript file in the `./src/processors` directory.

## Processors

Here is a list of available processors, click on each to get detailed documentation

- [Auction Bidder](./auction-bidder.md)
- [Historical Data Fetcher](./historical-data-fetcher.md)
- [Loan Caller](./loan-caller.md)
- [Term Offboarder](./term-offboarder.md)
- [TestnetMarketMaker](./testnet-market-maker.md)
- [UserSlasher](./user-slasher.md)

## Start a processor

### Debug mode 

`npm run debug:auction-bidder` (see package.json to see for other processors)

### In production

You will need to add env variables to start the processors you want. It'll be started by the ECGNode.js file automatically

Here are the different variables you need to set:

- HISTORICAL_DATA_FETCHER_ENABLED
- USER_SLASHER_ENABLED
- USER_SLASHER_ENABLED
- TERM_OFFBOARDER_ENABLED
- LOAN_CALLER_ENABLED
- AUCTION_BIDDER_ENABLED
- TERM_ONBOARDING_WATCHER_ENABLED

#### Example

To start the node + term offboarder, you can start with (from the .build directory):

`APP_NAME=ECG_NODE_BASIC_TEST NETWORK=SEPOLIA RPC_URL=https://sepolia.infura.io/v3/xxx RPC_URL_LISTENER=https://sepolia.infura.io/v3/xxx MARKET_ID=42 TERM_OFFBOARDER_ENABLED=true ETH_PRIVATE_KEY=0x0123456... node ECGNode.js`