import { JsonRpcProvider } from 'ethers';
import { ProtocolData } from '../../model/ProtocolData';
import {
  GetGuildTokenAddress,
  GetProfitManagerAddress,
  getTokenByAddress,
  getTokenByAddressNoError
} from '../../config/Config';
import {
  GuildToken__factory,
  LendingTerm as LendingTermType,
  LendingTerm__factory,
  ProfitManager__factory
} from '../../contracts/types';
import { DATA_DIR, MARKET_ID } from '../../utils/Constants';
import path from 'path';
import { WriteJSON, roundTo } from '../../utils/Utils';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { GetGaugeForMarketId } from '../../utils/ECGHelper';
import LendingTerm, { LendingTermStatus, LendingTermsFileStructure } from '../../model/LendingTerm';
import { norm } from '../../utils/TokenUtils';
import { Log, Warn } from '../../utils/Logger';
import { GetERC20Infos } from '../../utils/Web3Helper';
import { SendNotifications } from '../../utils/Notifications';

export default class LendingTermsFetcher {
  static async fetchAndSaveTerms(web3Provider: JsonRpcProvider, currentBlock: number) {
    Log('FetchECGData[Terms]: starting');
    const multicallProvider = MulticallWrapper.wrap(web3Provider);
    const guildTokenContract = GuildToken__factory.connect(await GetGuildTokenAddress(), multicallProvider);
    const gauges = await GetGaugeForMarketId(guildTokenContract, MARKET_ID, false);
    const profitManagerContract = ProfitManager__factory.connect(await GetProfitManagerAddress(), web3Provider);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promises: any[] = [];
    promises.push(profitManagerContract.minBorrow());
    promises.push(guildTokenContract.totalTypeWeight(MARKET_ID));
    for (const lendingTermAddress of gauges) {
      // Log(`FetchECGData: adding call for on lending term ${lendingTermAddress}`);
      const lendingTermContract = LendingTerm__factory.connect(lendingTermAddress, multicallProvider);
      promises.push(lendingTermContract.getParameters());
      promises.push(lendingTermContract.issuance());
      promises.push(lendingTermContract['debtCeiling()']());
      promises.push(lendingTermContract.auctionHouse());
      promises.push(guildTokenContract.getGaugeWeight(lendingTermAddress));
      promises.push(profitManagerContract.termSurplusBuffer(lendingTermAddress));
    }

    // wait the promises
    Log(`FetchECGData[Terms]: sending ${promises.length} multicall`);
    await Promise.all(promises);
    Log('FetchECGData[Terms]: end multicall');

    const lendingTerms: LendingTerm[] = [];
    let cursor = 0;
    const minBorrow: bigint = await promises[cursor++];
    const totalTypeWeight: bigint = await promises[cursor++];
    for (const lendingTermAddress of gauges) {
      // read promises in the same order as the multicall
      const termParameters: LendingTermType.LendingTermParamsStructOutput = await promises[cursor++];
      const issuance: bigint = await promises[cursor++];
      const debtCeiling: bigint = await promises[cursor++];
      const auctionHouseAddress: string = await promises[cursor++];
      const gaugeWeight: bigint = await promises[cursor++];
      const termSurplusBuffer: bigint = await promises[cursor++];

      const realCap = termParameters.hardCap > debtCeiling ? debtCeiling : termParameters.hardCap;
      const availableDebt = issuance > realCap ? 0n : realCap - issuance;
      let collateralToken = await getTokenByAddressNoError(termParameters.collateralToken);
      if (!collateralToken) {
        collateralToken = await GetERC20Infos(web3Provider, termParameters.collateralToken);
        Warn(
          `Token ${termParameters.collateralToken} not found in config. ERC20 infos: ${collateralToken.symbol} / ${collateralToken.decimals} decimals`
        );
        await SendNotifications(
          'LendingTermFetcher',
          `Token ${termParameters.collateralToken} not found in config`,
          `This does not break the fetcher but should be checked. ERC20 infos: ${collateralToken.symbol} / ${collateralToken.decimals} decimals`
        );
      }
      const interestRate = termParameters.interestRate.toString(10);
      const maxDebtPerCol = termParameters.maxDebtPerCollateralToken.toString(10);
      const label =
        `${collateralToken.symbol}` +
        `-${roundTo(norm(interestRate) * 100, 2)}%` +
        `-${roundTo(norm(maxDebtPerCol, 36 - collateralToken.decimals), 2)}`;
      lendingTerms.push({
        termAddress: lendingTermAddress,
        collateralAddress: termParameters.collateralToken,
        interestRate: interestRate,
        maxDebtPerCollateralToken: maxDebtPerCol,
        currentDebt: issuance.toString(10),
        hardCap: termParameters.hardCap.toString(10),
        availableDebt: availableDebt.toString(10),
        openingFee: termParameters.openingFee.toString(10),
        minPartialRepayPercent: termParameters.minPartialRepayPercent.toString(10),
        maxDelayBetweenPartialRepay: Number(termParameters.maxDelayBetweenPartialRepay.toString(10)),
        minBorrow: minBorrow.toString(10),
        status: LendingTermStatus.LIVE,
        label: label,
        collateralSymbol: collateralToken.symbol,
        collateralDecimals: collateralToken.decimals,
        permitAllowed: collateralToken.permitAllowed,
        auctionHouseAddress: auctionHouseAddress,
        debtCeiling: debtCeiling.toString(10),
        gaugeWeight: gaugeWeight.toString(10),
        issuance: issuance.toString(10),
        totalWeightForMarket: totalTypeWeight.toString(10),
        termSurplusBuffer: termSurplusBuffer.toString(10)
      });
    }

    // update status by calling deprecated gauges
    const deprecatedGauges = await guildTokenContract.deprecatedGauges();
    for (const lendingTerm of lendingTerms) {
      if (deprecatedGauges.includes(lendingTerm.termAddress)) {
        lendingTerm.status = LendingTermStatus.DEPRECATED;
      }
    }

    const lendingTermsPath = path.join(DATA_DIR, 'terms.json');
    const fetchData = Date.now();
    const termFileData: LendingTermsFileStructure = {
      updateBlock: currentBlock,
      updated: fetchData,
      updatedHuman: new Date(fetchData).toISOString(),
      terms: lendingTerms
    };

    WriteJSON(lendingTermsPath, termFileData);
    return lendingTerms;
  }
}
