import { GetProtocolData, ReadJSON, WaitUntilScheduled, WriteJSON, roundTo } from '../utils/Utils';
import {
  GetFullConfigFile,
  LoadConfiguration,
  LoadTokens,
  TokenConfig,
  getAllTokens,
  getTokenByAddress,
  getTokenBySymbol
} from '../config/Config';
import { GLOBAL_DATA_DIR } from '../utils/Constants';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { LendingTermsFileStructure } from '../model/LendingTerm';
import { LoanStatus, LoansFileStructure } from '../model/Loan';
import * as notif from '../utils/Notifications';
import { formatCurrencyValue, norm } from '../utils/TokenUtils';
import PriceService from '../services/price/PriceService';
import { ethers } from 'ethers';
import { HttpGet, HttpPost } from '../utils/HttpHelper';
import { OpenOceanSwapQuoteResponse } from '../model/OpenOceanApi';
import BigNumber from 'bignumber.js';
import { PendleSwapResponse } from '../model/PendleApi';
import { ProtocolDataFileStructure } from '../model/ProtocolData';
import { MessageBuilder } from 'discord-webhook-node';
import { SendMessageBuilder } from '../utils/DiscordHelper';
import { Webhook } from '@hyunsdev/discord-webhook';

async function SlippageAlerter() {
  process.title = 'SLIPPAGE_ALERTER';

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const startDate = Date.now();
    try {
      await CheckSlippagePerMarket();
      // await CheckSlippage();
    } catch (e) {
      console.error(e);
      await notif.SendNotifications('SlippageAlerter', 'Error when fetching slippage', JSON.stringify(e), false);
    }
    await WaitUntilScheduled(startDate, 30 * 60 * 1000);
  }
}

interface LastRunData {
  lastRecapMsgSentMs: number; // timestamp ms
  slippageAlertSentPerToken: { [tokenSymbol: string]: number }; // timestamp ms
}

interface CollateralData {
  totalAmount: number;
  tokenInfo: TokenConfig;
  tokenPrice: number;
  nbLoans: number;
}

interface PerMarketCollateralData {
  totalAmount: number;
  totalDebtPegToken: number;
  pegTokenPrice: number;
  tokenInfo: TokenConfig;
  tokenPrice: number;
  nbLoans: number;
}

interface PerMarketResult extends PerMarketCollateralData {
  marketId: number;
  collateralAmountUsd: number;
  soldAmountPegToken: number;
  debtAmountUsd: number;
  slippage: number;
  overCollateralizationWithSlippage: number;
  pegTokenInfo: TokenConfig;
}

async function CheckSlippagePerMarket() {
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
  let reportSent = false;
  for (const marketDir of marketDirs) {
    const totalCollateral: { [token: string]: PerMarketCollateralData } = {};
    const marketId = marketDir.split('_')[1];
    const marketConfig = config[Number(marketId)];
    if (Number(marketId) > 1e6) {
      // ignore test market
      continue;
    }

    const pegToken = getTokenByAddress(marketConfig.pegTokenAddress);

    const marketPath = path.join(GLOBAL_DATA_DIR, marketDir);
    const termsFileName = path.join(marketPath, 'terms.json');
    const termFile: LendingTermsFileStructure = ReadJSON(termsFileName);
    const loansFileName = path.join(marketPath, 'loans.json');
    const loansFile: LoansFileStructure = ReadJSON(loansFileName);
    const protocolDataFilename = path.join(GLOBAL_DATA_DIR, marketDir, 'protocol-data.json');

    const protocolDataFile = ReadJSON(protocolDataFilename) as ProtocolDataFileStructure;

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
          nbLoans: 0,
          totalDebtPegToken: 0,
          pegTokenPrice: await PriceService.GetTokenPrice(marketConfig.pegTokenAddress)
        };
      }

      totalCollateral[collateralToken.address].nbLoans++;
      totalCollateral[collateralToken.address].totalAmount += norm(loan.collateralAmount, collateralToken.decimals);
      totalCollateral[collateralToken.address].totalDebtPegToken +=
        norm(loan.loanDebt, 18) * norm(protocolDataFile.data.creditMultiplier, 18);
    }

    const results: PerMarketResult[] = [];

    for (const collateralData of Object.values(totalCollateral)) {
      const result: PerMarketResult = {
        collateralAmountUsd: collateralData.totalAmount * collateralData.tokenPrice,
        debtAmountUsd: collateralData.totalDebtPegToken * collateralData.pegTokenPrice,
        nbLoans: collateralData.nbLoans,
        pegTokenPrice: collateralData.pegTokenPrice,
        slippage: 0,
        tokenInfo: collateralData.tokenInfo,
        tokenPrice: collateralData.tokenPrice,
        totalAmount: collateralData.totalAmount,
        totalDebtPegToken: collateralData.totalDebtPegToken,
        soldAmountPegToken: 0,
        overCollateralizationWithSlippage: 0,
        pegTokenInfo: pegToken,
        marketId: Number(marketId)
      };

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
          `&tokenOutAddr=${marketConfig.pegTokenAddress}` +
          `&syTokenOutAddr=${collateralData.tokenInfo.pendleConfiguration.syTokenOut}` +
          '&slippage=0.10';

        const dataGet = await HttpGet<PendleSwapResponse>(urlGet);
        result.slippage = roundTo(Math.abs(dataGet.data.priceImpact) * 100, 2);
        result.soldAmountPegToken = norm(dataGet.data.amountTokenOut, pegToken.decimals);
      } else {
        const amountFull = new BigNumber(collateralData.totalAmount)
          .times(new BigNumber(10).pow(collateralData.tokenInfo.decimals))
          .toFixed(0);
        const urlGet =
          'https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes?' +
          `tokenIn=${collateralData.tokenInfo.address}` +
          `&tokenOut=${marketConfig.pegTokenAddress}` +
          `&amountIn=${amountFull}` +
          '&excludedSources=balancer-v1,balancer-v2-composable-stable,balancer-v2-stable,balancer-v2-weighted';

        const dataGet = await HttpGet<any>(urlGet);
        const urlPost = 'https://aggregator-api.kyberswap.com/arbitrum/api/v1/route/build';
        const dataPost = await HttpPost<any>(urlPost, {
          routeSummary: dataGet.data.routeSummary,
          slippageTolerance: 0.5 * 10_000,
          sender: '0x69e2D90935E438c26fFE72544dEE4C1306D80A56',
          recipient: '0x69e2D90935E438c26fFE72544dEE4C1306D80A56'
        });

        result.slippage = roundTo(
          Math.abs(1 - Number(dataPost.data.amountOutUsd) / Number(dataPost.data.amountInUsd)) * 100,
          2
        );

        result.soldAmountPegToken = norm(dataPost.data.amountOut, pegToken.decimals);
      }

      result.overCollateralizationWithSlippage = result.soldAmountPegToken / result.totalDebtPegToken;
      results.push(result);
    }

    // sort by diff between soldAmount and debt amount
    results.sort((a, b) => a.overCollateralizationWithSlippage - b.overCollateralizationWithSlippage);
    for (const result of results) {
      if (result.soldAmountPegToken < result.totalDebtPegToken) {
        await notif.SendNotificationsList('Slippage Alerter', 'TOO MUCH SLIPPAGE DETECTED', [
          {
            fieldName: 'Market',
            fieldValue: `${marketId} (${pegToken.symbol})`
          },
          {
            fieldName: 'Collateral',
            fieldValue: result.tokenInfo.symbol
          },
          {
            fieldName: 'Total debt',
            fieldValue: `${result.totalDebtPegToken} ($${roundTo(result.debtAmountUsd, 2)})`
          },
          {
            fieldName: 'Total collateral',
            fieldValue: `${result.totalAmount} ($${roundTo(result.collateralAmountUsd, 2)})`
          },
          {
            fieldName: 'Amount of peg token obtained by selling collateral',
            fieldValue: `${result.soldAmountPegToken} ($${roundTo(
              result.soldAmountPegToken * result.pegTokenPrice,
              2
            )})`
          },
          {
            fieldName: 'Slippage',
            fieldValue: `${result.slippage}%`
          }
        ]);
      }

      console.log(
        `MARKET ${marketId} | [${result.tokenInfo.symbol}]` +
          ` Total collateral: ${result.totalAmount}` +
          ` | $${result.totalAmount * result.tokenPrice}` +
          ` | Slippage: ${result.slippage}% | soldAmountPegToken ${result.soldAmountPegToken} | debt ${
            result.totalDebtPegToken
          } | overcollateralization ${roundTo(result.overCollateralizationWithSlippage * 100, 2)}%`
      );
    }

    // only send recap every 24 hours

    if (process.env.SLIPPAGE_REPORT_WEBHOOK_URL) {
      if (lastRunData.lastRecapMsgSentMs < Date.now() - 24 * 3600 * 1000) {
        const msgBuilder = new MessageBuilder()
          .setTitle(`[MARKET ${marketId} - ${pegToken.symbol}] Slippage Report`)
          .setTimestamp();

        for (const result of results) {
          msgBuilder.addField('-----------------------------------', `${result.tokenInfo.symbol}`, false);
          msgBuilder.addField(
            'Total collateral ',
            `${formatCurrencyValue(result.totalAmount)} ($${formatCurrencyValue(result.collateralAmountUsd)})`,
            true
          );
          msgBuilder.addField(
            'Total debt',
            `${formatCurrencyValue(result.totalDebtPegToken)} ($${formatCurrencyValue(result.debtAmountUsd)})`,
            true
          );
          msgBuilder.addField(
            'Max recoverable debt',
            `${formatCurrencyValue(result.soldAmountPegToken)} ($${formatCurrencyValue(
              result.soldAmountPegToken * result.pegTokenPrice
            )})`,
            true
          );
          msgBuilder.addField('Slippage ', `${result.slippage}%`, true);
          msgBuilder.addField(
            'Overcollateralization ',
            `${roundTo(result.overCollateralizationWithSlippage, 2)}`,
            true
          );
        }

        reportSent = true;
        await SendMessageBuilder(msgBuilder, process.env.SLIPPAGE_REPORT_WEBHOOK_URL);
      }
    }
  }

  if (reportSent) {
    lastRunData.lastRecapMsgSentMs = Date.now();
  }

  WriteJSON('slippage-alerter-last-run-data.json', lastRunData);
}

// async function CheckSlippage() {
//   await LoadTokens();
//   if (!existsSync('slippage-alerter-last-run-data.json')) {
//     WriteJSON('slippage-alerter-last-run-data.json', {
//       lastRecapMsgSentMs: 0
//     });
//   }
//   const lastRunData: LastRunData = ReadJSON('slippage-alerter-last-run-data.json');

//   // get all config
//   const config = await GetFullConfigFile();
//   const allTokens = getAllTokens();
//   const WETH = getTokenBySymbol('WETH');
//   const USDC = getTokenBySymbol('USDC');

//   const marketDirs = readdirSync(GLOBAL_DATA_DIR).filter((_) => _.startsWith('market_'));
//   const totalCollateral: { [token: string]: CollateralData } = {};

//   for (const marketDir of marketDirs) {
//     const marketId = marketDir.split('_')[1];
//     if (Number(marketId) > 1e6) {
//       // ignore test market
//       continue;
//     }

//     const marketPath = path.join(GLOBAL_DATA_DIR, marketDir);
//     const termsFileName = path.join(marketPath, 'terms.json');
//     const termFile: LendingTermsFileStructure = ReadJSON(termsFileName);
//     const loansFileName = path.join(marketPath, 'loans.json');
//     const loansFile: LoansFileStructure = ReadJSON(loansFileName);
//     for (const loan of loansFile.loans.filter((_) => _.status == LoanStatus.ACTIVE)) {
//       const termForLoan = termFile.terms.find((_) => _.termAddress == loan.lendingTermAddress);
//       if (!termForLoan) {
//         throw new Error(`Cannot find lending term with address ${loan.lendingTermAddress} on market ${marketId}`);
//       }

//       const collateralToken = getTokenByAddress(termForLoan.collateralAddress);
//       if (!totalCollateral[collateralToken.address]) {
//         totalCollateral[collateralToken.address] = {
//           totalAmount: 0,
//           tokenInfo: collateralToken,
//           tokenPrice: await PriceService.GetTokenPrice(collateralToken.address),
//           nbLoans: 0
//         };
//       }

//       totalCollateral[collateralToken.address].nbLoans++;
//       totalCollateral[collateralToken.address].totalAmount += norm(loan.collateralAmount, collateralToken.decimals);
//     }
//   }

//   for (const collateralData of Object.values(totalCollateral)) {
//     let slippage = 0;
//     if (collateralData.tokenInfo.pendleConfiguration) {
//       const amountFull = new BigNumber(collateralData.totalAmount)
//         .times(new BigNumber(10).pow(collateralData.tokenInfo.decimals))
//         .toFixed(0);
//       const urlGet =
//         'https://api-v2.pendle.finance/sdk/api/v1/swapExactPtForToken?' +
//         'chainId=42161' +
//         '&receiverAddr=0x69e2D90935E438c26fFE72544dEE4C1306D80A56' +
//         `&marketAddr=${collateralData.tokenInfo.pendleConfiguration.market}` +
//         `&amountPtIn=${amountFull}` +
//         `&tokenOutAddr=${
//           collateralData.tokenInfo.pendleConfiguration.basePricingAsset.symbol.startsWith('USD')
//             ? USDC.address
//             : WETH.address
//         }` +
//         `&syTokenOutAddr=${collateralData.tokenInfo.pendleConfiguration.syTokenOut}` +
//         '&slippage=0.10';

//       const dataGet = await HttpGet<PendleSwapResponse>(urlGet);
//       slippage = roundTo(Math.abs(dataGet.data.priceImpact) * 100, 2);
//     } else {
//       const amountFull = new BigNumber(collateralData.totalAmount)
//         .times(new BigNumber(10).pow(collateralData.tokenInfo.decimals))
//         .toFixed(0);
//       const urlGet =
//         'https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes?' +
//         `tokenIn=${collateralData.tokenInfo.address}` +
//         `&tokenOut=${WETH.address == collateralData.tokenInfo.address ? USDC.address : WETH.address}` +
//         `&amountIn=${amountFull}` +
//         '&excludedSources=balancer-v1,balancer-v2-composable-stable,balancer-v2-stable,balancer-v2-weighted';

//       const dataGet = await HttpGet<any>(urlGet);
//       const urlPost = 'https://aggregator-api.kyberswap.com/arbitrum/api/v1/route/build';
//       const dataPost = await HttpPost<any>(urlPost, {
//         routeSummary: dataGet.data.routeSummary,
//         slippageTolerance: 0.5 * 10_000,
//         sender: '0x69e2D90935E438c26fFE72544dEE4C1306D80A56',
//         recipient: '0x69e2D90935E438c26fFE72544dEE4C1306D80A56'
//       });

//       slippage = roundTo(Math.abs(1 - Number(dataPost.data.amountOutUsd) / Number(dataPost.data.amountInUsd)) * 100, 2);
//     }

//     console.log(
//       `[${collateralData.tokenInfo.symbol}]` +
//         ` Total collateral: ${collateralData.totalAmount}` +
//         ` | $${collateralData.totalAmount * collateralData.tokenPrice}` +
//         ` | Slippage: ${slippage}%`
//     );
//   }
// }

SlippageAlerter();
