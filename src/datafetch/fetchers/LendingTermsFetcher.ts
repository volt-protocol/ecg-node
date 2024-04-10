import { JsonRpcProvider } from 'ethers';
import { ProtocolData } from '../../model/ProtocolData';
import { GetGuildTokenAddress, GetProfitManagerAddress, getTokenByAddress } from '../../config/Config';
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
import { Log } from '../../utils/Logger';

export default class LendingTermsFetcher {
  static async fetchAndSaveTerms(web3Provider: JsonRpcProvider, protocolData: ProtocolData) {
    const multicallProvider = MulticallWrapper.wrap(web3Provider);
    const guildTokenContract = GuildToken__factory.connect(GetGuildTokenAddress(), multicallProvider);
    const gauges = await GetGaugeForMarketId(guildTokenContract, MARKET_ID, false);
    const profitManagerContract = ProfitManager__factory.connect(GetProfitManagerAddress(), web3Provider);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promises: any[] = [];
    promises.push(profitManagerContract.minBorrow());
    for (const lendingTermAddress of gauges) {
      Log(`FetchECGData: adding call for on lending term ${lendingTermAddress}`);
      const lendingTermContract = LendingTerm__factory.connect(lendingTermAddress, multicallProvider);
      promises.push(lendingTermContract.getParameters());
      promises.push(lendingTermContract.issuance());
      promises.push(lendingTermContract['debtCeiling()']());
      promises.push(lendingTermContract.auctionHouse());
    }

    // wait the promises
    Log(`FetchECGData[Terms]: sending ${promises.length} multicall`);
    await Promise.all(promises);
    Log('FetchECGData[Terms]: end multicall');

    const lendingTerms: LendingTerm[] = [];
    let cursor = 0;
    const minBorrow: bigint = await promises[cursor++];
    const creditMultiplier: bigint = protocolData.creditMultiplier;
    for (const lendingTermAddress of gauges) {
      // read promises in the same order as the multicall
      const termParameters: LendingTermType.LendingTermParamsStructOutput = await promises[cursor++];
      const issuance: bigint = await promises[cursor++];
      const debtCeiling: bigint = await promises[cursor++];
      const auctionHouseAddress: string = await promises[cursor++];

      const realCap = termParameters.hardCap > debtCeiling ? debtCeiling : termParameters.hardCap;
      const availableDebt = issuance > realCap ? 0n : realCap - issuance;
      lendingTerms.push({
        termAddress: lendingTermAddress,
        collateralAddress: termParameters.collateralToken,
        interestRate: termParameters.interestRate.toString(10),
        borrowRatio: termParameters.maxDebtPerCollateralToken.toString(10),
        maxDebtPerCollateralToken: termParameters.maxDebtPerCollateralToken.toString(10),
        currentDebt: issuance.toString(10),
        hardCap: termParameters.hardCap.toString(10),
        availableDebt: availableDebt.toString(10),
        openingFee: termParameters.openingFee.toString(10),
        minPartialRepayPercent: termParameters.minPartialRepayPercent.toString(10),
        maxDelayBetweenPartialRepay: Number(termParameters.maxDelayBetweenPartialRepay.toString(10)),
        minBorrow: minBorrow.toString(10),
        status: LendingTermStatus.LIVE,
        label: '',
        collateralSymbol: '',
        collateralDecimals: 0,
        permitAllowed: false,
        auctionHouseAddress: auctionHouseAddress
      });
    }

    // update data like collateral token symbol and decimals
    // and recompute borrowRatio
    for (const lendingTerm of lendingTerms) {
      const collateralToken = getTokenByAddress(lendingTerm.collateralAddress);
      lendingTerm.collateralSymbol = collateralToken.symbol;
      lendingTerm.collateralDecimals = collateralToken.decimals;
      lendingTerm.permitAllowed = collateralToken.permitAllowed;

      lendingTerm.borrowRatio = (
        (BigInt(lendingTerm.borrowRatio) * 10n ** BigInt(lendingTerm.collateralDecimals)) /
        creditMultiplier
      ).toString(10);
      lendingTerm.label = `${lendingTerm.collateralSymbol}-${roundTo(
        norm(lendingTerm.interestRate) * 100,
        2
      )}%-${roundTo(norm(lendingTerm.borrowRatio), 2)}`;
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
      updated: fetchData,
      updatedHuman: new Date(fetchData).toISOString(),
      terms: lendingTerms
    };

    WriteJSON(lendingTermsPath, termFileData);
    return lendingTerms;
  }
}
