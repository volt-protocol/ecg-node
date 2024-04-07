# ECG-Node

Open-source node for Ethereum Credit Guild off-chain tooling (calls, liquidations, offboarding...) 

# Run it

## Install nodejs

All development is done using:
- nodejs v20.9.0
- npm v10.1.0

Refer to NodeJS website for installation guidelines: https://nodejs.org/en

or use nvm: https://github.com/nvm-sh/nvm

## Clone

`git clone https://github.com/volt-protocol/ecg-node.git`

## Install dependencies

`npm install`

## Generating Contract Types

Before building the project, you need to generate TypeScript typings for your smart contracts. This ensures that TypeScript can recognize and type-check the contract interactions within your code.

`npm run typechain`

## Build

`npm run build`

All files needed will be in the `./build` directory

## Run

This a very basic example about how to start the ECG-Node in your shell. 
This assume your on an Unix platform.

### Copy the config file to the build directory

Location:
`./ecg-node-config.json`

Should be copied to `./build/ecg-node-config.json`

By default, only the data fetcher will start. You can select which ECG-Node processors you want to start by setting "enabled: true"

[More about the config file here](./docs/config-file.md)

Then you can start the ECG-Node using the node command:

`node ./ECGNode.js`

### Requirements

You need to have an `RPC_URL` environment variable set or you need to launch with an env variable

Example on Unix:

```
export RPC_URL=YOUR_SEPOLIA_RPC_URL
node ./ECGNode.js
```

### Basic start logs

#### Data fetcher

Running the ECG-Node without any processor will still start the data fetcher and the event listener.

You should see these logs:

```
[ECG-NODE] STARTED
FetchECGData: fetching data up to block 5470009
FetchECGData: fetching
FetchECGData: adding call for on lending term 0x820E8F9399514264Fd8CB21cEE5F282c723131f6
FetchECGData: adding call for on lending term 0x938998fca53D8BFD91BC1726D26238e9Eada596C
FetchECGData[Terms]: sending 9 multicall
FetchECGData[Terms]: end multicall
FetchECGData[Gauges]: getting gauges infos
FetchECGData[Gauges]: Updated 2 gauges
FetchECGData[Loans]: sending loans() multicall for 83 loans
FetchECGData[Loans]: end multicall
FetchECGData[Auctions]: sending getAuction() multicall for 19 loans
FetchECGData[Auctions]: end multicall
FetchECGData: finished fetching

```

And you should see the `./data` dir (full path should be `./build/data`):

![data files](./docs/images/data-files.png)

These files store the most up-to-date data about the protocol. See [ECG Data Fetcher](./docs/datafetcher/ecg-data-fetcher.md) for more details

#### Listeners
At the end of the logs, you should see the listener being started:

```
Starting/restarting events listener
Started the event listener
Starting listener on guild token 0x79E2B8553Da5361d90Ed08A9E3F2f3e5E5fF2f8f
Started the event listener
Started the event processor
Starting listener on term 0x820E8F9399514264Fd8CB21cEE5F282c723131f6
Starting listener on term 0x938998fca53D8BFD91BC1726D26238e9Eada596C
```

These are event listeners that will check protocol changes that require updating the protocol data. Events like: LoanOpen, LoanClose, AddGauge (new lending term), etc...

When computing an event, it will trigger a new data fetch ==> ensuring all *.json files are the most up-to-date at all times.
