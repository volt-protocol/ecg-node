# Historical Data Fetcher

This processor fetches historical data about the protocol in order to make them available via an API

For example, it is used by the ECG frontend to draw graphs.

This does not have to be started by a user who just want to keep the protocol healthy.

## Requirements

The RPC_URL in the env variables must be an archival node

## Parameters

None (except the enabled true/false)