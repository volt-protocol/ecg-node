import { ReadJSON, WriteJSON, roundTo } from '../utils/Utils';
import { GetFullConfigFile, getTokenByAddress, getTokenBySymbol } from '../config/Config';
import { GLOBAL_DATA_DIR } from '../utils/Constants';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { LendingTermsFileStructure } from '../model/LendingTerm';
import { LoanStatus, LoansFileStructure } from '../model/Loan';
import * as notif from '../utils/Notifications';
import { formatCurrencyValue, norm } from '../utils/TokenUtils';
import PriceService from '../services/price/PriceService';
import { HttpGet } from '../utils/HttpHelper';
import BigNumber from 'bignumber.js';
import { PendleSwapResponse } from '../model/PendleApi';
import { ProtocolDataFileStructure } from '../model/ProtocolData';
import { MessageBuilder } from 'discord-webhook-node';
import { SendMessageBuilder } from '../utils/DiscordHelper';
import { CollateralData, LastRunData, PerMarketCollateralData, PerMarketResult } from './SlippageAlerterModels';

const lastRunDataFileFullPath = path.join(GLOBAL_DATA_DIR, 'slippage-alerter-last-run-data.json');

async function SlippageAlerter() {
  process.title = 'SLIPPAGE_ALERTER';
  // const startDate = Date.now();
  try {
    let lastRunData: LastRunData = {
      lastRecapMsgSentMs: 0,
      slippageAlertSentPerToken: {}
    };

    if (existsSync(lastRunDataFileFullPath)) {
      lastRunData = ReadJSON(lastRunDataFileFullPath);
    }

    await CheckSlippagePerMarket(lastRunData);
    await CheckSlippage(lastRunData);

    WriteJSON(lastRunDataFileFullPath, lastRunData);
  } catch (e) {
    console.error(e);
    await notif.SendNotifications('SlippageAlerter', 'Error when fetching slippage', JSON.stringify(e), false);
  }
  // await WaitUntilScheduled(startDate, 30 * 60 * 1000);
}

async function CheckSlippagePerMarket(lastRunData: LastRunData) {
  // get all config
  const config = await GetFullConfigFile();

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

    const pegToken = await getTokenByAddress(marketConfig.pegTokenAddress);

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

      const collateralToken = await getTokenByAddress(termForLoan.collateralAddress);
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

        const expiryDate = new Date(collateralData.tokenInfo.pendleConfiguration.expiry);
        const urlGet =
          expiryDate.getTime() < Date.now()
            ? 'https://api-v2.pendle.finance/sdk/api/v1/redeemPyToToken?chainId=42161' +
              '&receiverAddr=0x69e2D90935E438c26fFE72544dEE4C1306D80A56' +
              `&ytAddr=${collateralData.tokenInfo.pendleConfiguration.ytAddress}` +
              `&amountPyIn=${amountFull}` +
              `&tokenOutAddr=${pegToken.address}` +
              `&syTokenOutAddr=${collateralData.tokenInfo.pendleConfiguration.syTokenOut}` +
              '&slippage=0.1'
            : 'https://api-v2.pendle.finance/sdk/api/v1/swapExactPtForToken?' +
              'chainId=42161' +
              '&receiverAddr=0x69e2D90935E438c26fFE72544dEE4C1306D80A56' +
              `&marketAddr=${collateralData.tokenInfo.pendleConfiguration.market}` +
              `&amountPtIn=${amountFull}` +
              `&tokenOutAddr=${pegToken.address}` +
              `&syTokenOutAddr=${collateralData.tokenInfo.pendleConfiguration.syTokenOut}` +
              '&excludedSources=balancer-v1,balancer-v2-composable-stable,balancer-v2-stable,balancer-v2-weighted' +
              '&slippage=0.1';

        try {
          const dataGet = await HttpGet<PendleSwapResponse>(urlGet);
          if (dataGet.data.priceImpact == -1) {
            // compute slippage via amountIn vs amountOut
            const amountOutUsd = norm(dataGet.data.amountTokenOut, pegToken.decimals) * result.pegTokenPrice;
            const amountInUsd = collateralData.totalAmount * collateralData.tokenPrice;
            result.slippage = roundTo((1 - amountOutUsd / amountInUsd) * 100, 2);
          } else {
            result.slippage = roundTo(Math.abs(dataGet.data.priceImpact) * 100, 2);
          }
          result.soldAmountPegToken = norm(dataGet.data.amountTokenOut, pegToken.decimals);
        } catch (e) {
          result.slippage = 100;
          result.errorMsg = `Cannot swap ${collateralData.tokenInfo.symbol} for ${pegToken.symbol} on pendle AMM`;
        }
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

        if (Number(dataGet.data.routeSummary.amountOutUsd) >= Number(dataGet.data.routeSummary.amountInUsd)) {
          result.slippage = 0;
        } else {
          result.slippage = roundTo(
            (1 - Number(dataGet.data.routeSummary.amountOutUsd) / Number(dataGet.data.routeSummary.amountInUsd)) * 100,
            2
          );
        }

        result.soldAmountPegToken = norm(dataGet.data.routeSummary.amountOut, pegToken.decimals);
      }

      result.overCollateralizationWithSlippage = result.soldAmountPegToken / result.totalDebtPegToken;
      results.push(result);
    }

    // sort by diff between soldAmount and debt amount
    results.sort((a, b) => b.slippage - a.slippage);
    for (const result of results) {
      if (result.soldAmountPegToken < result.totalDebtPegToken) {
        // await notif.SendNotificationsList('Slippage Alerter', 'TOO MUCH SLIPPAGE DETECTED', [
        //   {
        //     fieldName: 'Market',
        //     fieldValue: `${marketId} (${pegToken.symbol})`
        //   },
        //   {
        //     fieldName: 'Collateral',
        //     fieldValue: result.tokenInfo.symbol
        //   },
        //   {
        //     fieldName: 'Total debt',
        //     fieldValue: `${formatCurrencyValue(result.totalDebtPegToken)} ($${formatCurrencyValue(
        //       result.debtAmountUsd
        //     )})`
        //   },
        //   {
        //     fieldName: 'Total collateral',
        //     fieldValue: `${formatCurrencyValue(result.totalAmount)} ($${formatCurrencyValue(
        //       result.collateralAmountUsd
        //     )})`
        //   },
        //   {
        //     fieldName: 'Max recoverable debt',
        //     fieldValue: `${formatCurrencyValue(result.soldAmountPegToken)} ($${formatCurrencyValue(
        //       result.soldAmountPegToken * result.pegTokenPrice
        //     )})`
        //   },
        //   {
        //     fieldName: 'Slippage',
        //     fieldValue: `${result.slippage}%`
        //   }
        // ]);
      }

      console.log(
        `MARKET ${marketId} | [${result.tokenInfo.symbol}]` +
          ` Total collateral: ${result.totalAmount}` +
          ` | $${result.totalAmount * result.tokenPrice}` +
          ` | Slippage: ${result.slippage}% | soldAmountPegToken ${result.soldAmountPegToken} | debt ${
            result.totalDebtPegToken
          } | overcollateralization ${roundTo(result.overCollateralizationWithSlippage, 2)}`
      );
    }

    // only send recap every 24 hours
    if (process.env.SLIPPAGE_REPORT_WEBHOOK_URL && results.length > 0) {
      if (lastRunData.lastRecapMsgSentMs < Date.now() - 24 * 3600 * 1000) {
        const msgBuilder = new MessageBuilder()
          .setTitle(`[MARKET ${marketId} - ${pegToken.symbol}] Slippage Report`)
          .setTimestamp();

        for (const result of results) {
          msgBuilder.addField('-----------------------------------', `${result.tokenInfo.symbol}`, false);

          if (result.errorMsg) {
            msgBuilder.addField('Error ', result.errorMsg, true);
          } else {
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
            // msgBuilder.addField(
            //   'Max recoverable debt',
            //   `${formatCurrencyValue(result.soldAmountPegToken)} ($${formatCurrencyValue(
            //     result.soldAmountPegToken * result.pegTokenPrice
            //   )})`,
            //   true
            // );
            msgBuilder.addField('Slippage ', `${result.slippage}%`, true);
            // msgBuilder.addField(
            //   'Overcollateralization ',
            //   `${roundTo(result.overCollateralizationWithSlippage, 2)}`,
            //   true
            // );
          }
        }

        reportSent = true;
        // console.log('hey');
        // console.log(JSON.stringify(msgBuilder, null, 2));
        await SendMessageBuilder(msgBuilder, process.env.SLIPPAGE_REPORT_WEBHOOK_URL);
      }
    }
  }

  if (reportSent) {
    lastRunData.lastRecapMsgSentMs = Date.now() - 10 * 60 * 1000;
  }
}

async function CheckSlippage(lastRunData: LastRunData) {
  // get all config
  const WETH = await getTokenBySymbol('WETH');
  const USDC = await getTokenBySymbol('USDC');

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

      const collateralToken = await getTokenByAddress(termForLoan.collateralAddress);
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
    let slippagePct = 0;
    if (collateralData.tokenInfo.pendleConfiguration) {
      const amountFull = new BigNumber(collateralData.totalAmount)
        .times(new BigNumber(10).pow(collateralData.tokenInfo.decimals))
        .toFixed(0);

      const expiryDate = new Date(collateralData.tokenInfo.pendleConfiguration.expiry);
      const urlGet =
        expiryDate.getTime() < Date.now()
          ? 'https://api-v2.pendle.finance/sdk/api/v1/redeemPyToToken?chainId=42161' +
            '&receiverAddr=0x69e2D90935E438c26fFE72544dEE4C1306D80A56' +
            `&ytAddr=${collateralData.tokenInfo.pendleConfiguration.ytAddress}` +
            `&amountPyIn=${amountFull}` +
            `&tokenOutAddr=${
              collateralData.tokenInfo.pendleConfiguration.basePricingAsset.symbol.startsWith('USD')
                ? USDC.address
                : WETH.address
            }` +
            `&syTokenOutAddr=${collateralData.tokenInfo.pendleConfiguration.syTokenOut}` +
            '&slippage=0.1'
          : 'https://api-v2.pendle.finance/sdk/api/v1/swapExactPtForToken?' +
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
            '&excludedSources=balancer-v1,balancer-v2-composable-stable,balancer-v2-stable,balancer-v2-weighted' +
            '&slippage=0.1';

      try {
        const dataGet = await HttpGet<PendleSwapResponse>(urlGet);
        slippagePct = roundTo(Math.abs(dataGet.data.priceImpact) * 100, 2);
      } catch (e) {
        slippagePct = 100;
      }
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

      if (Number(dataGet.data.routeSummary.amountOutUsd) >= Number(dataGet.data.routeSummary.amountInUsd)) {
        slippagePct = 0;
      } else {
        slippagePct = roundTo(
          (1 - Number(dataGet.data.routeSummary.amountOutUsd) / Number(dataGet.data.routeSummary.amountInUsd)) * 100,
          2
        );
      }
    }

    if (process.env.SLIPPAGE_REPORT_WEBHOOK_URL) {
      if (slippagePct >= 5) {
        if (
          !lastRunData.slippageAlertSentPerToken[collateralData.tokenInfo.symbol] ||
          lastRunData.slippageAlertSentPerToken[collateralData.tokenInfo.symbol] <= Date.now() - 6 * 3600 * 1000
        ) {
          const msgBuilder = new MessageBuilder().setTitle('SLIPPAGE ALERT').setTimestamp();
          msgBuilder.setDescription(`${collateralData.tokenInfo.symbol} slippage is too high: ${slippagePct}%`);
          msgBuilder.addField(
            'Total collateral to sell',
            `${formatCurrencyValue(collateralData.totalAmount)} ($${formatCurrencyValue(
              collateralData.totalAmount * collateralData.tokenPrice
            )})`,
            false
          );

          await SendMessageBuilder(msgBuilder, process.env.SLIPPAGE_REPORT_WEBHOOK_URL);

          lastRunData.slippageAlertSentPerToken[collateralData.tokenInfo.symbol] = Date.now();
        }
      }
    }

    console.log(
      `[${collateralData.tokenInfo.symbol}]` +
        ` Total collateral: ${collateralData.totalAmount}` +
        ` | $${collateralData.totalAmount * collateralData.tokenPrice}` +
        ` | Slippage: ${slippagePct}%`
    );
  }
}

SlippageAlerter();
