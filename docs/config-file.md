# ECG Node Configuration

The node configuration is stored in a .json file at the root of this project

`ecg-node-config.json`

By default, it looks like that:

``` json
{
    "processors": {
        "LOAN_CALLER": {
            "enabled": false
        },
        "TERM_OFFBOARDER": {
            "enabled": false,
            "tokens": {
                "WBTC": {
                    "minOvercollateralization": 1.2
                },
                "sDAI": {
                    "minOvercollateralization": 1.035
                }
            }
        },
        "TERM_ONBOARDING_WATCHER": {
            "enabled": false
        },
        "USER_SLASHER": {
            "enabled": false,
            "minSizeToSlash": 20000
        },
        "AUCTION_BIDDER": {
            "enabled": false,
            "enableForgive": true,
            "minProfitUsdc": 20
        },
        "TESTNET_MARKET_MAKER": {
            "enabled": false,
            "threshold": 0.005,
            "uniswapPairs": [
                {
                    "path": ["USDC", "sDAI"],
                    "poolAddress": "0x52633CA942d320e750dc1335790fA4aCc66d0DD0",
                    "targetRatio": 1.05
                }
            ]
        },
        "HISTORICAL_DATA_FETCHER": {
            "enabled": false
        }
    }
}
```

Its role is to enable/disable and to give some parameters for the processors, see [processors](./processors/processors.md) for more details.