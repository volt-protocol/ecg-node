# Loan Caller

The Loan Caller checks all active loans and verify if any can/should be called

There are 3 possibilities for a loan to be callable:

1. The lending term is deprecated (has been offboarded)
2. The current loan debt (taking the interest into account) are above the max borrow for the term
3. The partial repay delay is passed 

If any of these 3 checks is true, then the Loan Caller will broadcast a transaction to call the loan

## Requirements

You need to have a wallet private key in the environment variables. The wallet must have enough eth to pay the transaction gas.

Example on unix:

`export ETH_PRIVATE_KEY=abcdef123456779....`

## Parameters

None (except the enabled true/false)