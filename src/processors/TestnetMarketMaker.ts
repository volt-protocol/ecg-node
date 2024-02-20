import { GetNodeConfig, sleep } from '../utils/Utils';
import { UniswapV2Router__factory, UniswapV2Pair__factory, UniswapV2Router } from '../contracts/types';
import { GetUniswapV2RouterAddress, getTokenBySymbol } from '../config/Config';
import { ethers } from 'ethers';

const RUN_EVERY_SEC = 120;

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

    const web3Provider = new ethers.JsonRpcProvider(rpcURL);
    const signer = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, web3Provider);
    const uniswapRouter = UniswapV2Router__factory.connect(GetUniswapV2RouterAddress(), signer);

    for (let i = 0; i < config.uniswapPairs.length; i++) {
      const token0 = getTokenBySymbol(config.uniswapPairs[i].path[0]);
      const token1 = getTokenBySymbol(config.uniswapPairs[i].path[1]);
      const targetRatio = config.uniswapPairs[i].targetRatio;
      const threshold = config.threshold;
      const pairAddress = config.uniswapPairs[i].poolAddress;
      const uniswapPair = UniswapV2Pair__factory.connect(pairAddress, web3Provider);
      console.log(`TestnetMarketMaker: checking pair ${token0.symbol}-${token1.symbol}`);

      const reserves = await uniswapPair.getReserves();
      let spotRatio =
        Number(reserves[0] * BigInt(10 ** (18 - token0.decimals))) /
        Number(reserves[1] * BigInt(10 ** (18 - token1.decimals)));
      const diff = Math.abs(spotRatio - targetRatio);
      if (diff < threshold) {
        //console.log(`TestnetMarketMaker: pair almost balanced, no need to swap spotRatio = ${spotRatio}`);
        continue;
      }

      // if we have to swap token0 for token1
      if (spotRatio < targetRatio) {
        let step = 1n * BigInt(10 ** token0.decimals);
        let amountIn = 0n;
        let amountOut = 0n;
        while (spotRatio < targetRatio) {
          amountIn += step;
          amountOut = getAmountOut(amountIn, reserves[0], reserves[1]);
          let reservesAfter = [reserves[0] + amountIn, reserves[1] - amountOut];
          spotRatio =
            Number(reservesAfter[0] * BigInt(10 ** (18 - token0.decimals))) /
            Number(reservesAfter[1] * BigInt(10 ** (18 - token1.decimals)));
        }
        console.log(`TestnetMarketMaker: swap ${amountIn} ${token0.symbol} -> ${amountOut} ${token1.symbol}`);

        await swapExactTokensForTokens(
          amountIn,
          (amountOut * 995n) / 1000n, // max 0.5% slippage
          [token0.address, token1.address],
          signer.address,
          Math.floor(Date.now() / 1000) + 120, // 2 minutes deadline
          uniswapRouter
        );
      }
      // if we have to swap token1 for token0
      else {
        let step = 1n * BigInt(10 ** token1.decimals);
        let amountIn = 0n;
        let amountOut = 0n;
        while (spotRatio > targetRatio) {
          amountIn += step;
          amountOut = getAmountOut(amountIn, reserves[1], reserves[0]);
          let reservesAfter = [reserves[0] - amountOut, reserves[1] + amountIn];
          spotRatio =
            Number(reservesAfter[0] * BigInt(10 ** (18 - token0.decimals))) /
            Number(reservesAfter[1] * BigInt(10 ** (18 - token1.decimals)));
        }
        console.log(`TestnetMarketMaker: swap ${amountIn} ${token1.symbol} -> ${amountOut} ${token0.symbol}`);

        await swapExactTokensForTokens(
          amountIn,
          (amountOut * 995n) / 1000n, // max 0.5% slippage
          [token1.address, token0.address],
          signer.address,
          Math.floor(Date.now() / 1000) + 120, // 2 minutes deadline
          uniswapRouter
        );
      }
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
  amountIn: bigint,
  minAmountOut: bigint,
  path: string[],
  to: string,
  deadline: number,
  uniswapRouter: UniswapV2Router
) {
  const txReceipt = await uniswapRouter.swapExactTokensForTokens(amountIn, minAmountOut, path, to, deadline);
  await txReceipt.wait();
}

TestnetMarketMaker();
