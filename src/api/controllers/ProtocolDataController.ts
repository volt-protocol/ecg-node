import fs from 'fs';
import path from 'path';
import { GLOBAL_DATA_DIR, NETWORK } from '../../utils/Constants';
import { ReadJSON } from '../../utils/Utils';
import { norm } from '../../utils/TokenUtils';
import { GetFullConfigFile, getAllTokens } from '../../config/Config';
import { AirdropDataResponse } from '../model/AirdropDataResponse';
import { HistoricalData, HistoricalDataMulti } from '../../model/HistoricalData';
import { ProtocolDataFileStructure } from '../../model/ProtocolData';
import PriceService from '../../services/price/PriceService';

class ProtocolDataController {
  static async GetAllPrices(): Promise<{ [tokenAddress: string]: number }> {
    const allPrices: { [tokenAddress: string]: number } = {};
    for (const token of getAllTokens()) {
      allPrices[token.address] = await PriceService.GetTokenPrice(token.address);
    }

    return allPrices;
  }
  static async GetAirdropData(): Promise<AirdropDataResponse> {
    const airdropData: AirdropDataResponse = {
      rebasingSupplyUsd: 0,
      termSurplusBufferUsd: 0,
      totalIssuanceUsd: 0,
      marketUtilization: {},
      marketTVL: {},
      marketDebt: {}
    };

    if (NETWORK == 'SEPOLIA') {
      return airdropData;
    }

    const fullConfig = await GetFullConfigFile();

    const marketDirs = fs.readdirSync(GLOBAL_DATA_DIR).filter((_) => _.startsWith('market_'));
    for (const marketDir of marketDirs) {
      const marketId = marketDir.split('_')[1];
      if (Number(marketId) > 1e6) {
        // ignore test market
        continue;
      }

      const marketPath = path.join(GLOBAL_DATA_DIR, marketDir);
      const aprDataFilename = path.join(marketPath, 'history', 'apr-data.json');
      const surplusBufferFilename = path.join(marketPath, 'history', 'surplus-buffer.json');
      const totalIssuanceFilename = path.join(marketPath, 'history', 'credit-total-issuance.json');
      const totalSupplyFilename = path.join(marketPath, 'history', 'credit-supply.json');
      const tvlFilename = path.join(marketPath, 'history', 'tvl.json');
      const protocolDataFilename = path.join(marketPath, 'protocol-data.json');

      if (!fs.existsSync(aprDataFilename)) {
        throw new Error(`DATA FILE NOT FOUND FOR ${marketDir}`);
      }
      if (!fs.existsSync(surplusBufferFilename)) {
        throw new Error(`DATA FILE NOT FOUND FOR ${marketDir}`);
      }
      if (!fs.existsSync(totalIssuanceFilename)) {
        throw new Error(`DATA FILE NOT FOUND FOR ${marketDir}`);
      }
      if (!fs.existsSync(protocolDataFilename)) {
        throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
      }
      if (!fs.existsSync(totalSupplyFilename)) {
        throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
      }
      if (!fs.existsSync(tvlFilename)) {
        throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
      }

      const aprData: HistoricalDataMulti = ReadJSON(aprDataFilename);
      const totalIssuanceData: HistoricalData = ReadJSON(totalIssuanceFilename);
      const surplusBufferData: HistoricalDataMulti = ReadJSON(surplusBufferFilename);
      const protocolDataFile: ProtocolDataFileStructure = ReadJSON(protocolDataFilename);
      const totalSupplyData: HistoricalData = ReadJSON(totalSupplyFilename);
      const tvlData: HistoricalData = ReadJSON(tvlFilename);

      // read only the last data
      const lastRebasing = aprData.values[Number(Object.keys(aprData.values).at(-1))].rebasingSupply;
      const lastCreditTotalIssuance = totalIssuanceData.values[Number(Object.keys(totalIssuanceData.values).at(-1))];
      const lastCreditTotalSupply = totalSupplyData.values[Number(Object.keys(totalSupplyData.values).at(-1))];
      const lastTvlData = tvlData.values[Number(Object.keys(tvlData.values).at(-1))];
      let surplusBuffer = 0;
      for (const termBuffer of Object.values(
        surplusBufferData.values[Number(Object.keys(surplusBufferData.values).at(-1))]
      )) {
        surplusBuffer += termBuffer;
      }

      const creditMultiplierNorm = norm(protocolDataFile.data.creditMultiplier);
      const rebasingPegToken = lastRebasing * creditMultiplierNorm;
      const lastCreditTotalIssuancePegToken = lastCreditTotalIssuance * creditMultiplierNorm;
      const surplusBufferPegToken = surplusBuffer * creditMultiplierNorm;
      // get price of the peg token
      let pegTokenPrice = await PriceService.GetTokenPrice(fullConfig[Number(marketId)].pegTokenAddress);
      if (!pegTokenPrice) {
        pegTokenPrice = 0;
      }
      airdropData.rebasingSupplyUsd += rebasingPegToken * pegTokenPrice;
      airdropData.termSurplusBufferUsd += surplusBufferPegToken * pegTokenPrice;
      airdropData.totalIssuanceUsd += lastCreditTotalIssuancePegToken * pegTokenPrice;

      airdropData.marketUtilization[Number(marketId)] = Math.min(1, lastCreditTotalIssuance / lastCreditTotalSupply);
      airdropData.marketTVL[Number(marketId)] = lastTvlData;
      airdropData.marketDebt[Number(marketId)] = lastCreditTotalIssuance * pegTokenPrice;
    }
    return airdropData;
  }
}

export default ProtocolDataController;
