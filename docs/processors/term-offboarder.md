# Term Offboarder

The Term Offboarder checks that all the active lending terms are healthy by checking for over-collateralization between the collateral price and the peg token price.

If the over-collateralization is lower than what's configured, it will propose an offboard and vote for the offboarding of the term

## Requirements

You need to have a wallet private key in the environment variables. The wallet must have enough ETH to pay the transaction gas.

Example on Unix:

`export ETH_PRIVATE_KEY=abcdef123456779....`


## Parameters

``` json
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
}
```


| Parameter  | type  | description  | example   |
|---|---|---|---|
| performCleanup  | boolean  | whether or not to perform cleanup (remove offboarded terms)  | true/false |
| onlyLogging  | boolean  | whether or not to only log the actions instead of performing them  | true/false |
| defaultMinOvercollateralization  | number  | the default minimum over-collateralization before proposing an offboarding  | 1.2 |
| tokens  | object  | the, per token, minimum over-collateralization before proposing an offboarding  | see after |


per tokens parameters

| Parameter  | type  | description  | example   |
|---|---|---|---|
| doNotOffboardCollateral  | boolean  | whether or not to do not offboard terms with this collateral | true/false |
| defaultMinOvercollateralization  | number  | the default minimum over-collateralization before proposing an offboarding  | 1.2 |
| auctionDurationSpecifics  | object[]  | specific configuration per auction duration  | see after |

auctionDurationSpecifics
| Parameter  | type  | description  | example   |
|---|---|---|---|
| maxMidpointDuration  | number  | the maximum duration of the midpoint auction | 1800 |
| minOvercollateralization  | number  | the minimum over-collateralization before proposing an offboarding  | 1.2 |

This configuration allows to reduce the minOvercollateralization for shorter auction durations