# Hosting the ECG-Node with PM2

Using PM2 facilitates hosting and running

## Step by step

1. Install pm2 on the server, see https://pm2.keymetrics.io/
1. Build the project with `npm run build`
2. Deploy the `./build` directory where you want. In this example we will deploy it to `/app/ecg-node/`
3. Copy `package.json` into `/app/ecg-node/`
4. Install dependencies with `npm install`
5. Copy the `ecg-node-config.json` file into `/app/ecg-node/` and update it like that, which will only start the [TERM_ONBOARDING_WATCHER](../processors/term-onboarding-watcher.md) processor

``` json
{
    "processors": {
        "LOAN_CALLER": {
            "enabled": false
        },
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
        },
        "TERM_ONBOARDING_WATCHER": {
            "enabled": true
        },
        "USER_SLASHER": {
            "enabled": false,
            "minSizeToSlash": 20000
        },
        "AUCTION_BIDDER": {
            "enabled": false,
            "enableForgive": true,
            "minProfitUsdc": 20
        },
        "TESTNET_MARKET_MAKER": {
            "enabled": false,
            "threshold": 0.005,
            "uniswapPairs": [
                {
                    "path": ["USDC", "sDAI"],
                    "poolAddress": "0x52633CA942d320e750dc1335790fA4aCc66d0DD0",
                    "targetRatio": 1.05
                }
            ]
        },
        "HISTORICAL_DATA_FETCHER": {
            "enabled": false
        }
    }
}
```
6. Create a pm2 config file named `ecg-node.pm2.config.js` in the `/app/ecg-node` folder

``` javascript
module.exports = {
    apps : [
    {
      name: "ecg-node-sepolia",
      script: "/app/ecg-node/ECGNode.js",
      cwd: "/app/ecg-node",
      log_file: "/app/ecg-node/logs/ecg-node.log",
      watch: false,
      time: true,
      env: {
        "RPC_URL":"{{SEPOLIA_RPC_URL}}",
        "EXPLORER_URI":"https://sepolia.etherscan.io",
        "WATCHER_TG_BOT_ID":"{{TG_BOT_ID}}",
        "WATCHER_TG_CHAT_ID":"{{TG_CHAT_ID}}",
        "WATCHER_DISCORD_WEBHOOK_URL":"{{DISCORD_WEBHOOK_URL}}",
        "APP_ENV":"SEPOLIA",
        "ETH_PRIVATE_KEY": "{{YOUR PRIVATE KEY}}"
      }
    }
  ]
}
```

7. Start the pm2 process: `pm2 start ecg-node.pm2.config.js`
8. See that the process is started: `pm2 ls`
9. Check the logs `pm2 logs ecg-node-sepolia`

## Starting other processors

Update the `ecg-node-config.json` file and restart the PM2 process

`pm2 restart ecg-node-sepolia`