# ECG-Node Documentation

Welcome to the Ethereum Credit Guild Node documentation.

The ECG-NODE is an Open-source node for Ethereum Credit Guild off-chain tooling (calls, liquidations, offboarding...) aiming to enable users holding GUILD tokens to act as safe-keepers of the protocol.

In this documentation, you will find how to configure your ECG-Node so that it runs the various jobs needed to keep the credit guild healthy.

## Summary

The ECG-Node is a modular platform that can be launched by enabling or disabling features (called processors). The node starts with at least one goal: fetching the current ECG data (about lending terms, loans, auctions, etc...)

Then, other features can be added and launched as standalone scripts but managed by the main one. Making it easy for the user to start/stop => only the ECGNode script must be started or stopped, it will take care of the rest.

Processors detailed documentation is available [here](./processors/processors.md)

## Configuration 

You can look at the needed configuration file before deploying [here](./config-file.md)

## Running & Hosting the ECG-Node

You can see an example hosting tutorial using an unix server and pm2 [here](./hosting/host-with-pm2.md)
