# Processors

The processors are like features that you can enable or disable from running on your node deployment.

They're launched in separate processes and are all more or less using the protocol data (stored in the `.json` files of the `./data` directory)

Each processor is very specific and aims to be as small as possible to be as simple as possible. The general goal of the processors is to maintain the credit guild healthy by monitoring collateral token prices, loan repayments, auctions, etc...

As an ECG-Node user, you might want to activate or not a list of processors so that it fits your needs as a protocol safe keeper.

Most of the processors are in a loop, running and waiting again and again. Some are restarted more often than others. You will see that in the detailed documentation.

## Code

Each processor is a single typescript file in the `./src/processors` directory.

## Processors

Here is a list of available processors, click on each to get detailed documentation

- [Auction Bidder](./auction-bidder.md)
- [Historical Data Fetcher](./historical-data-fetcher.md)
- [Loan Caller](./loan-caller.md)
- [Term Offboarder](./term-offboarder.md)
- [Term Onboarding Watcher](./term-onboarding-watcher.md)
- [TestnetMarketMaker](./testnet-market-maker.md)
- [UserSlasher](./user-slasher.md)