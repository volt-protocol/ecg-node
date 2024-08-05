import { JsonRpcProvider } from 'ethers';
import {
  GetGuildTokenAddress,
  GetLendingTermOffboardingAddress,
  GetProfitManagerAddress,
  getTokenByAddressNoError
} from '../../config/Config';
import {
  GuildToken,
  GuildToken__factory,
  LendingTermOffboarding__factory,
  LendingTerm as LendingTermType,
  LendingTerm__factory,
  ProfitManager,
  ProfitManager__factory
} from '../../contracts/types';
import { DATA_DIR, MARKET_ID } from '../../utils/Constants';
import path from 'path';
import { WriteJSON, retry, roundTo } from '../../utils/Utils';
import { MulticallProvider, MulticallWrapper } from 'ethers-multicall-provider';
import { GetGaugeForMarketId } from '../../utils/ECGHelper';
import LendingTerm, { LendingTermStatus, LendingTermsFileStructure } from '../../model/LendingTerm';
import { norm } from '../../utils/TokenUtils';
import { Log, Warn } from '../../utils/Logger';
import { GetERC20Infos, GetMulticallProvider, GetWeb3Provider } from '../../utils/Web3Helper';
import { SendNotifications } from '../../utils/Notifications';

export default class LendingTermsFetcher {
  static async fetchAndSaveTerms(web3Provider: JsonRpcProvider, currentBlock: number) {
    Log('FetchECGData[Terms]: starting');
    const multicallProvider = GetMulticallProvider();
    const guildTokenContract = GuildToken__factory.connect(await GetGuildTokenAddress(), multicallProvider);
    const gauges = await GetGaugeForMarketId(guildTokenContract, MARKET_ID, false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = await retry(() => LendingTermsFetcher.multicallLendingTermData(gauges), [], 5, 10);

    const lendingTerms: LendingTerm[] = [];
    let cursor = 0;
    const minBorrow: bigint = results[cursor++];
    const totalTypeWeight: bigint = results[cursor++];
    for (const lendingTermAddress of gauges) {
      // read results in the same order as the multicall
      const termParameters: LendingTermType.LendingTermParamsStructOutput = results[cursor++];
      const issuance: bigint = results[cursor++];
      const debtCeiling: bigint = results[cursor++];
      const auctionHouseAddress: string = results[cursor++];
      const gaugeWeight: bigint = results[cursor++];
      const termSurplusBuffer: bigint = results[cursor++];

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

    // check if terms have been cleaned up
    const lendingTermOffboardingContract = LendingTermOffboarding__factory.connect(
      await GetLendingTermOffboardingAddress(),
      multicallProvider
    );

    const offboardStatusResults = await Promise.all(
      deprecatedGauges.map((_) => lendingTermOffboardingContract.canOffboard(_))
    );

    for (let i = 0; i < deprecatedGauges.length; i++) {
      const deprecatedGauge = deprecatedGauges[i];
      const foundTerm = lendingTerms.find((_) => _.termAddress == deprecatedGauge);
      if (foundTerm && offboardStatusResults[i] == 0n) {
        foundTerm.status = LendingTermStatus.CLEANED;
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

  private static async multicallLendingTermData(terms: string[]) {
    const multicallProvider = GetMulticallProvider();
    const promises: any[] = [];
    const guildTokenContract = GuildToken__factory.connect(await GetGuildTokenAddress(), multicallProvider);
    const profitManagerContract = ProfitManager__factory.connect(await GetProfitManagerAddress(), multicallProvider);
    promises.push(profitManagerContract.minBorrow());
    promises.push(guildTokenContract.totalTypeWeight(MARKET_ID));
    for (const lendingTermAddress of terms) {
      //Log(`FetchECGData: adding call for on lending term ${lendingTermAddress}`);
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
    const results = await Promise.all(promises);
    Log('FetchECGData[Terms]: end multicall');
    return results;
  }
}
