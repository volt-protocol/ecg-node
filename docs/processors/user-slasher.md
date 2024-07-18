# User Slasher

The user slasher is responsible for calling applyGaugeLoss on each user who had voted for a lending term that caused bad debt to the protocol. Effectively burning their guild tokens.

## Requirements

You need to have a wallet private key in the environment variables. The wallet must have enough ETH to pay the transaction gas.

Example on Unix:

`export ETH_PRIVATE_KEY=abcdef123456779....`

## Parameters


``` json
"USER_SLASHER": {
    "minSizeToSlash": 20000
}
```

| Parameter  | type  | description  | example   |
|---|---|---|---|
| minSizeToSlash  | number  | The minimum of guild token to be slashed before sending a transaction |  20000 |