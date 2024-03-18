import { GetNodeConfig, roundTo, sleep } from '../utils/Utils';
import { UniswapV2Router__factory, UniswapV2Pair__factory, ERC20__factory } from '../contracts/types';
import { GetUniswapV2RouterAddress, TokenConfig, getTokenBySymbol } from '../config/Config';
import { ethers } from 'ethers';
import { norm } from '../utils/TokenUtils';
import { SendNotificationsList } from '../utils/Notifications';
import { GetWeb3Provider } from '../utils/Web3Helper';
import { GetTokenPrice } from '../utils/Price';

const RUN_EVERY_SEC = 120;

const web3Provider = GetWeb3Provider();
let lastNotification = 0;
const NOTIFICATION_DELAY = 12 * 60 * 60 * 1000; // send notification every 12h

/**
 * Market maker for testnet tokens
 * Assumptions:
 * - The address broadcasting has enough ETH to sign transactions
 * - The address broadcasting has enough tokens to swap
 * - The address broadcasting has enough allowance on Uniswap to swap
 */
async function TestnetMarketMaker() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const sendNotification = lastNotification + NOTIFICATION_DELAY < Date.now();
    process.title = 'TESTNET_MARKET_MAKER';
    console.log('TestnetMarketMaker: starting');
    const config = GetNodeConfig().processors.TESTNET_MARKET_MAKER;

    const rpcURL = process.env.RPC_URL;
    if (!rpcURL) {
      throw new Error('Cannot find RPC_URL in env');
    }
    if (!process.env.ETH_PRIVATE_KEY) {
      throw new Error('Cannot find ETH_PRIVATE_KEY in env');
    }

    const fields: { fieldName: string; fieldValue: string }[] = [];

    const signer = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, web3Provider);
    for (let i = 0; i < config.uniswapPairs.length; i++) {
      const token0 = getTokenBySymbol(config.uniswapPairs[i].path[0]);
      const token1 = getTokenBySymbol(config.uniswapPairs[i].path[1]);
      const threshold = config.threshold;
      const pairAddress = config.uniswapPairs[i].poolAddress;
      const uniswapPair = UniswapV2Pair__factory.connect(pairAddress, web3Provider);
      console.log(`TestnetMarketMaker: checking pair ${token0.symbol}-${token1.symbol}`);

      const priceToken0 = await GetTokenPrice(token0.mainnetAddress || token0.address);
      const priceToken1 = await GetTokenPrice(token1.mainnetAddress || token1.address);
      const targetRatio = priceToken1 / priceToken0;
      const reserves = await uniswapPair.getReserves();
      let spotRatio =
        Number(reserves[0] * BigInt(10 ** (18 - token0.decimals))) /
        Number(reserves[1] * BigInt(10 ** (18 - token1.decimals)));

      const diff = Math.abs((spotRatio - targetRatio) / targetRatio);
      console.log(
        `TestnetMarketMaker: price diff is ${roundTo(diff * 100, 2)}%. Acceptable diff: ${config.threshold * 100}%`
      );

      if (diff < threshold) {
        console.log(
          `TestnetMarketMaker: pair almost balanced, no need to swap spotRatio = ${spotRatio} / targetRatio = ${targetRatio}`
        );
      } else {
        // if we have to swap token0 for token1
        if (spotRatio < targetRatio) {
          const step = 1n * BigInt(10 ** (token1.decimals - 2));
          let amountIn = 0n;
          let amountOut = 0n;
          while (spotRatio < targetRatio) {
            amountIn += step;
            amountOut = getAmountOut(amountIn, reserves[0], reserves[1]);
            const reservesAfter = [reserves[0] + amountIn, reserves[1] - amountOut];
            spotRatio =
              Number(reservesAfter[0] * BigInt(10 ** (18 - token0.decimals))) /
              Number(reservesAfter[1] * BigInt(10 ** (18 - token1.decimals)));
          }
          console.log(
            `TestnetMarketMaker: swap ${norm(amountIn, token0.decimals)} ${token0.symbol} -> ${norm(
              amountOut,
              token1.decimals
            )} ${token1.symbol}`
          );

          // approve token0 to the router
          await swapExactTokensForTokens(
            token0,
            token1,
            1 / targetRatio,
            amountIn,
            (amountOut * 995n) / 1000n, // max 0.5% slippage
            [token0.address, token1.address],
            signer.address,
            Math.floor(Date.now() / 1000) + 120, // 2 minutes deadline
            signer
          );
        }
        // if we have to swap token1 for token0
        else {
          const step = 1n * BigInt(10 ** (token1.decimals - 2));
          let amountIn = 0n;
          let amountOut = 0n;
          while (spotRatio > targetRatio) {
            amountIn += step;
            amountOut = getAmountOut(amountIn, reserves[1], reserves[0]);
            const reservesAfter = [reserves[0] - amountOut, reserves[1] + amountIn];
            spotRatio =
              Number(reservesAfter[0] * BigInt(10 ** (18 - token0.decimals))) /
              Number(reservesAfter[1] * BigInt(10 ** (18 - token1.decimals)));
          }
          console.log(
            `TestnetMarketMaker: swap ${norm(amountIn, token1.decimals)} ${token1.symbol} -> ${norm(
              amountOut,
              token0.decimals
            )} ${token0.symbol}`
          );

          await swapExactTokensForTokens(
            token1,
            token0,
            targetRatio,
            amountIn,
            (amountOut * 995n) / 1000n, // max 0.5% slippage
            [token1.address, token0.address],
            signer.address,
            Math.floor(Date.now() / 1000) + 120, // 2 minutes deadline
            signer
          );
        }
      }

      if (sendNotification) {
        const reserves = await uniswapPair.getReserves();
        const spotRatio =
          Number(reserves[0] * BigInt(10 ** (18 - token0.decimals))) /
          Number(reserves[1] * BigInt(10 ** (18 - token1.decimals)));

        const ratioDiff = roundTo(Math.abs((targetRatio - spotRatio) / targetRatio) * 100, 2);
        // const fields: { fieldName: string; fieldValue: string }[] = [];
        if (targetRatio < 1) {
          fields.push({
            fieldName: `${token0.symbol}->${token1.symbol} real price`,
            fieldValue: (1 / targetRatio).toString()
          });
          fields.push({
            fieldName: `${token0.symbol}->${token1.symbol} univ2 price `,
            fieldValue: `${1 / spotRatio} (${ratioDiff}% diff)`
          });
        } else {
          fields.push({
            fieldName: `${token1.symbol}->${token0.symbol} real price`,
            fieldValue: targetRatio.toString()
          });
          fields.push({
            fieldName: `${token1.symbol}->${token0.symbol} univ2 price`,
            fieldValue: `${spotRatio} (${ratioDiff}% diff)`
          });
        }
      }
    }

    if (sendNotification) {
      fields.push({
        fieldName: 'Next update: ',
        fieldValue: `${new Date(Date.now() + NOTIFICATION_DELAY).toISOString()}`
      });
      await SendNotificationsList('MarketMaker', 'Market update', fields);
      lastNotification = Date.now();
    }

    await sleep(RUN_EVERY_SEC * 1000);
  }
}

function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  const amountOut = numerator / denominator;
  return amountOut;
}

async function swapExactTokensForTokens(
  fromToken: TokenConfig,
  toToken: TokenConfig,
  targetRatio: number,
  amountIn: bigint,
  minAmountOut: bigint,
  path: string[],
  to: string,
  deadline: number,
  signer: ethers.Wallet
) {
  const routerAddress = GetUniswapV2RouterAddress();
  // approve fromToken amountIn to the router
  const erc20Contract = ERC20__factory.connect(fromToken.address, signer);
  await (await erc20Contract.approve(routerAddress, amountIn)).wait();
  const uniswapRouter = UniswapV2Router__factory.connect(routerAddress, signer);

  const txReceipt = await uniswapRouter.swapExactTokensForTokens(amountIn, minAmountOut, path, to, deadline);
  await txReceipt.wait();
}

TestnetMarketMaker();
