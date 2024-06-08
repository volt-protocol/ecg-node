import { ReadJSON, WaitUntilScheduled, WriteJSON, roundTo } from '../src/utils/Utils';
import {
  GetFullConfigFile,
  LoadConfiguration,
  LoadTokens,
  TokenConfig,
  getAllTokens,
  getTokenByAddress,
  getTokenBySymbol
} from '../src/config/Config';
import { GLOBAL_DATA_DIR } from '../src/utils/Constants';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { LendingTermsFileStructure } from '../src/model/LendingTerm';
import { LoanStatus, LoansFileStructure } from '../src/model/Loan';
import * as notif from '../src/utils/Notifications';
import { norm } from '../src/utils/TokenUtils';
import PriceService from '../src/services/price/PriceService';
import { ethers } from 'ethers';
import { HttpGet, HttpPost } from '../src/utils/HttpHelper';
import { OpenOceanSwapQuoteResponse } from '../src/model/OpenOceanApi';
import BigNumber from 'bignumber.js';
import { PendleSwapResponse } from '../src/model/PendleApi';

async function SlippageAlerter() {
  process.title = 'SLIPPAGE_ALERTER';

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const startDate = Date.now();
    try {
      await CheckSlippage();
    } catch (e) {
      console.error(e);
      await notif.SendNotifications('SlippageAlerter', 'Error when fetching slippage', JSON.stringify(e), false);
    }
    await WaitUntilScheduled(startDate, 30 * 60 * 1000);
  }
}

interface LastRunData {
  lastRecapMsgSentMs: number; // timestamp ms
}

interface CollateralData {
  totalAmount: number;
  tokenInfo: TokenConfig;
  tokenPrice: number;
  nbLoans: number;
}

async function CheckSlippage() {
  await LoadTokens();
  if (!existsSync('slippage-alerter-last-run-data.json')) {
    WriteJSON('slippage-alerter-last-run-data.json', {
      lastRecapMsgSentMs: 0
    });
  }
  const lastRunData: LastRunData = ReadJSON('slippage-alerter-last-run-data.json');

  // get all config
  const config = await GetFullConfigFile();
  const allTokens = getAllTokens();
  const WETH = getTokenBySymbol('WETH');
  const USDC = getTokenBySymbol('USDC');

  const marketDirs = readdirSync(GLOBAL_DATA_DIR).filter((_) => _.startsWith('market_'));
  const totalCollateral: { [token: string]: CollateralData } = {};

  for (const marketDir of marketDirs) {
    const marketId = marketDir.split('_')[1];
    if (Number(marketId) > 1e6) {
      // ignore test market
      continue;
    }

    const marketPath = path.join(GLOBAL_DATA_DIR, marketDir);
    const termsFileName = path.join(marketPath, 'terms.json');
    const termFile: LendingTermsFileStructure = ReadJSON(termsFileName);
    const loansFileName = path.join(marketPath, 'loans.json');
    const loansFile: LoansFileStructure = ReadJSON(loansFileName);
    for (const loan of loansFile.loans.filter((_) => _.status == LoanStatus.ACTIVE)) {
      const termForLoan = termFile.terms.find((_) => _.termAddress == loan.lendingTermAddress);
      if (!termForLoan) {
        throw new Error(`Cannot find lending term with address ${loan.lendingTermAddress} on market ${marketId}`);
      }

      const collateralToken = getTokenByAddress(termForLoan.collateralAddress);
      if (!totalCollateral[collateralToken.address]) {
        totalCollateral[collateralToken.address] = {
          totalAmount: 0,
          tokenInfo: collateralToken,
          tokenPrice: await PriceService.GetTokenPrice(collateralToken.address),
          nbLoans: 0
        };
      }

      totalCollateral[collateralToken.address].nbLoans++;
      totalCollateral[collateralToken.address].totalAmount += norm(loan.collateralAmount, collateralToken.decimals);
    }
  }

  for (const collateralData of Object.values(totalCollateral)) {
    let slippage = 0;
    if (collateralData.tokenInfo.pendleConfiguration) {
      const amountFull = new BigNumber(collateralData.totalAmount)
        .times(new BigNumber(10).pow(collateralData.tokenInfo.decimals))
        .toFixed(0);
      const urlGet =
        'https://api-v2.pendle.finance/sdk/api/v1/swapExactPtForToken?' +
        'chainId=42161' +
        '&receiverAddr=0x69e2D90935E438c26fFE72544dEE4C1306D80A56' +
        `&marketAddr=${collateralData.tokenInfo.pendleConfiguration.market}` +
        `&amountPtIn=${amountFull}` +
        `&tokenOutAddr=${
          collateralData.tokenInfo.pendleConfiguration.basePricingAsset.symbol.startsWith('USD')
            ? USDC.address
            : WETH.address
        }` +
        `&syTokenOutAddr=${collateralData.tokenInfo.pendleConfiguration.syTokenOut}` +
        '&slippage=0.10';

      const dataGet = await HttpGet<PendleSwapResponse>(urlGet);
      slippage = roundTo(Math.abs(dataGet.data.priceImpact) * 100, 2);
    } else {
      const amountFull = new BigNumber(collateralData.totalAmount)
        .times(new BigNumber(10).pow(collateralData.tokenInfo.decimals))
        .toFixed(0);
      const urlGet =
        'https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes?' +
        `tokenIn=${collateralData.tokenInfo.address}` +
        `&tokenOut=${WETH.address == collateralData.tokenInfo.address ? USDC.address : WETH.address}` +
        `&amountIn=${amountFull}` +
        '&excludedSources=balancer-v1,balancer-v2-composable-stable,balancer-v2-stable,balancer-v2-weighted';

      const dataGet = await HttpGet<any>(urlGet);
      const urlPost = 'https://aggregator-api.kyberswap.com/arbitrum/api/v1/route/build';
      const dataPost = await HttpPost<any>(urlPost, {
        routeSummary: dataGet.data.routeSummary,
        slippageTolerance: 0.5 * 10_000, // 0.005 -> 50 (0.5%)
        sender: '0x69e2D90935E438c26fFE72544dEE4C1306D80A56',
        recipient: '0x69e2D90935E438c26fFE72544dEE4C1306D80A56'
      });

      slippage = roundTo(Math.abs(1 - Number(dataPost.data.amountOutUsd) / Number(dataPost.data.amountInUsd)) * 100, 2);
    }

    console.log(
      `[${collateralData.tokenInfo.symbol}]` +
        ` Total collateral: ${collateralData.totalAmount}` +
        ` | $${collateralData.totalAmount * collateralData.tokenPrice}` +
        ` | Slippage: ${slippage}%`
    );
  }
}

SlippageAlerter();
