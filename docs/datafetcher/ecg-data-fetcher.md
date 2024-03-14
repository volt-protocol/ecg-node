# Data Fetcher

The data fetcher is the base component of the ECG-Node: its role is to fetch the most up-to-date data about the protocol and to store it in json file on the file system

Upon starting the ECG-Node, you will quickly see the `./data` directory being populated by json files

After a few seconds (minutes) of fetching, it should contains the following files:

- auctions.json
- gauges.json
- loans.json
- protocol-data.json
- sync.json
- terms.json

Each files are storing data so that other processors don't have to fetch the data from the blockchain (which would be too costly).

This fetcher is automatically started upon starting the node and then every 10 minutes OR any time an (important) event is received.

## Event Watcher

After the initial data fetch, the node also starts the EventListener and the EventProcessor.

These two components are used to quickly react to events by constantly listening to various contracts (mainly the Guild contract and the Lending Terms).

When an event is deemed important enough, a data fetch is triggered: this ensure that the various .json files in the `./data` directory are always up-to-date

## Event list

Here are the events that are watched

### Guild Contract

On the Guild Token contract, the watched events are:

- AddGauge
- IncrementGaugeWeight
- DecrementGaugeWeight

On all the lending terms, a watcher is started and listens to:

- LoanOpen
- LoanAddCollateral
- LoanPartialRepay
- LoanClose
- LoanCall
- SetAuctionHouse