# ECG Node Configuration

The node configuration is a .json file stored on the public github (and fetched from it by the Node when you start it).

It's in `./params/node-config.{NETWORK}.{MARKET_ID}.json`

The node configuration is by market, meaning each existing markets should have their own configuration file.

Here's an example of what the node configuration file looks like:

``` json
{
    "processors": {
        "LOAN_CALLER": {},
        "TERM_OFFBOARDER": {
            "performCleanup": true,
            "onlyLogging": false,
            "defaultMinOvercollateralization": 1.2,
            "tokens": {
                "OD": {
                    "doNotOffboardCollateral": true,
                    "defaultMinOvercollateralization": 1.1,
                    "auctionDurationSpecifics": []
                },
                "PT-USDe-29AUG2024": {
                    "defaultMinOvercollateralization": 1.1,
                    "auctionDurationSpecifics": []
                },
                "WETH": {
                    "defaultMinOvercollateralization": 1.2,
                    "auctionDurationSpecifics": [
                        {
                            "maxMidpointDuration": 1800,
                            "minOvercollateralization": 1.1
                        }
                    ]
                }
            }
        },
        "TERM_ONBOARDING_WATCHER": {},
        "USER_SLASHER": {
            "minSizeToSlash": 20000
        },
        "AUCTION_BIDDER": {
            "enableForgive": true,
            "minProfitUsd": 5
        },
        "HISTORICAL_DATA_FETCHER": {},
        "TESTNET_MARKET_MAKER": {
            "threshold": 0.005,
            "uniswapPairs": []
        }
    }
}
```

This configuration is used to set the parameters for each of the node's processors, see [processors](./processors/processors.md) for more details.