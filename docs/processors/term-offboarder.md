# Term Offboarder

The Term Offboarder checks that all the active lending terms are healthy by checking of over collateralization between the collateral price and the peg token price.

If the overcollateralization is lower than what's configured, it will propose an offboard and vote for the offboarding of the term

## Requirements

You need to have a wallet private key in the environment variables. The wallet must have enough eth to pay the transaction gas.

Example on unix:

`export ETH_PRIVATE_KEY=abcdef123456779....`


## Parameters

``` json
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
}
```


| Parameter  | type  | description  | example   |
|---|---|---|---|
| enabled  | boolean  | whether or not to activate this processor  |  true/false |
| tokens  | object  | the, per token, minimum overcollateralization before proposing an offboarding  | see above |