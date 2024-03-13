# Auction Bidder

The auction bidder's goal is to bid on auctions as soon as the auction becomes profitable.

It is the one keeping the protocol bad-debt free.

## Requirements

You need to have a wallet private key in the environment variables. The wallet must have enough ETH to pay the transaction gas.

Example on Unix:

`export ETH_PRIVATE_KEY=abcdef123456779....`

## Parameters

``` json
"AUCTION_BIDDER": {
    "enabled": false,
    "enableForgive": true,
    "minProfitUsdc": 20
}
```

| Parameter  | type  | description  | example   |
|---|---|---|---|
| enabled  | boolean  | whether or not to activate this processor  |  true/false |
| enableForgive  | boolean  | whether or not to let the auction bidder broadcast forgive transaction  |  true/false |
| minProfitUsdc  | number | The minimum profit before broadcasting a bid  | 20  |
