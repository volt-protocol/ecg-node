# Adding a new pendle PT token

## Find the market for the token:
find market using this api: https://api-v2.pendle.finance/core/v1/42161/markets?order_by=name%3A1&skip=0&limit=100&is_active=true

Search for the pendle PT token address, should be in a "pt" object
On the main object there is an "address" juste before a name that should be "Pendle Market", this is the market address
![pendle market](/docs/misc/pendle-json-example.png)
Save market address


## Find the syTokenOut for the marketAddress

find syTokenOut using this api: https://api-v2.pendle.finance/sdk/api/v1/syTokenInOut?chainId=42161&marketAddr=0x2dfaf9a5e4f293bceede49f2dba29aacdd88e0c4
Save outputToken address

