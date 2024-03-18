import { GetWeb3Provider } from '../src/utils/Web3Helper';
import { getTokenBySymbol } from '../src/config/Config';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import { UniswapV2Router__factory } from '../src/contracts/types/factories/UniswapV2Router__factory';
import { ERC20__factory } from '../src/contracts/types/factories/ERC20__factory';
import { sleep } from '../src/utils/Utils';

dotenv.config();

const web3Provider = GetWeb3Provider(5000);
const privateKey = process.env.ETH_PRIVATE_KEY;
const _1e18 = 10n ** 18n;
const uniswapv2RouterAddress = '0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008';

async function UniswapV2PoolCreator() {
  console.log('UniswapV2PoolCreator: starting');
  const WBTC = getTokenBySymbol('WBTC');
  const USDC = getTokenBySymbol('USDC');

  const signer = new ethers.Wallet(privateKey!, web3Provider);
  const ERC20_WBTC = ERC20__factory.connect(WBTC.address, signer);
  const ERC20_USDC = ERC20__factory.connect(USDC.address, signer);

  //   await (await ERC20_WBTC.approve(uniswapv2RouterAddress, 1000n * 10n ** 8n)).wait();
  //   await (await ERC20_USDC.approve(uniswapv2RouterAddress, 20_000_000n * 10n ** 6n)).wait();

  const router = UniswapV2Router__factory.connect(uniswapv2RouterAddress, signer);
  const tx = await router.addLiquidity(
    WBTC.address,
    USDC.address,
    1000n * 10n ** 8n,
    20_000_000n * 10n ** 6n,
    1000n * 10n ** 8n,
    20_000_000n * 10n ** 6n,
    signer.address,
    Math.round(Date.now() / 1000) + 1000
  );

  let txFinished = false;
  while (!txFinished) {
    const txReceipt = await web3Provider.getTransactionReceipt(tx.hash);
    if (txReceipt && txReceipt.blockNumber) {
      console.log(`transaction has been mined in block ${txReceipt.blockNumber}`);
      txFinished = true;
    } else {
      console.log(`waiting for transaction ${tx.hash} to be mined`);
      await sleep(5000);
    }
  }
}

UniswapV2PoolCreator();
