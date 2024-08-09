# Auction Bidder

The auction bidder's goal is to bid on auctions as soon as the auction becomes profitable.

It is the one keeping the protocol bad-debt free.

## Requirements

You need to have a wallet private key in the environment variables. The wallet must have enough ETH to pay the transaction gas.

Example on Unix:

`export BIDDER_ETH_PRIVATE_KEY=abcdef123456779....`

## Parameters

``` json
"AUCTION_BIDDER": {
    "enableForgive": true,
    "minProfitUsd": 5
},
```

| Parameter  | type  | description  | example   |
|---|---|---|---|
| enableForgive  | boolean  | whether or not to let the auction bidder broadcast forgive transaction  |  true/false |
| minProfitUsd  | number | The minimum profit before broadcasting a bid  | 20  |
