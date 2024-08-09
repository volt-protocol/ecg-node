# Hosting the ECG-Node with PM2

Using PM2 facilitates hosting and running

## Step by step

1. Install pm2 on the server, see https://pm2.keymetrics.io/
1. Build the project with `npm run build`
2. Deploy the `./build` directory where you want. In this example, we will deploy it to `/app/ecg-node/`
3. Copy `package.json` into `/app/ecg-node/`
4. Install dependencies with `npm install`
5. Create a pm2 config file named `ecg-node.pm2.config.js` in the `/app/ecg-node` folder

``` javascript
module.exports = {
    apps : [
    {
      name: "ecg-node-sepolia",
      script: "/app/ecg-node/ECGNode.js",
      cwd: "/app/ecg-node",
      log_file: "/app/ecg-node/logs/ecg-node-sepolia.log",
      watch: false,
      time: true,
      env: {
        "APP_NAME": "ECG_NODE",
        "NETWORK": "SEPOLIA",
        "RPC_URL":"{{SEPOLIA_RPC_URL}}",
        "RPC_URL_LISTENER":"{{SEPOLIA_RPC_URL}}",
        "EXPLORER_URI":"https://sepolia.etherscan.io",
        "MARKET_ID":42,
        "TERM_OFFBOARDER_ENABLED": "false",
        "LOAN_CALLER_ENABLED": "false",
        "AUCTION_BIDDER_ENABLED": "false",
        "HISTORICAL_DATA_FETCHER_ENABLED": "false",
        "USER_SLASHER_ENABLED": "false",
        "TERM_ONBOARDING_WATCHER_ENABLED": "false",
      }
    }
  ]
}
```

6. Start the pm2 process: `pm2 start ecg-node.pm2.config.js`
7. See that the process is started: `pm2 ls`
8. Check the logs `pm2 logs ecg-node-sepolia`

## Starting other processors

Update the `ecg-node.pm2.config.json` file to add more processors (using env variable) and restart

Example enabling the term offboarder (don't forget to also add the private key in the .env file)
``` javascript
module.exports = {
    apps : [
    {
      name: "ecg-node-sepolia",
      script: "/app/ecg-node/ECGNode.js",
      cwd: "/app/ecg-node",
      log_file: "/app/ecg-node/logs/ecg-node-sepolia.log",
      watch: false,
      time: true,
      env: {
        "APP_NAME": "ECG_NODE",
        "NETWORK": "SEPOLIA",
        "RPC_URL":"{{SEPOLIA_RPC_URL}}",
        "RPC_URL_LISTENER":"{{SEPOLIA_RPC_URL}}",
        "EXPLORER_URI":"https://sepolia.etherscan.io",
        "MARKET_ID":42,
        "ETH_PRIVATE_KEY": "{{YOUR_PRIVATE_KEY}}",
        "TERM_OFFBOARDER_ENABLED": "true",
        "LOAN_CALLER_ENABLED": "false",
        "AUCTION_BIDDER_ENABLED": "false",
        "HISTORICAL_DATA_FETCHER_ENABLED": "false",
        "USER_SLASHER_ENABLED": "false",
        "TERM_ONBOARDING_WATCHER_ENABLED": "false",
      }
    }
  ]
}
```
Restart the process (with the pm2.config.js file to reload env variables)
`pm2 start ecg-node.pm2.config.js --only ecg-node-sepolia`