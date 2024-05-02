import {
  ApiHistoricalData,
  ApiHistoricalDataMulti,
  HistoricalData,
  HistoricalDataMulti
} from '../../model/HistoricalData';
import fs from 'fs';
import path from 'path';
import { GLOBAL_DATA_DIR } from '../../utils/Constants';
import { ReadJSON } from '../../utils/Utils';

class HistoricalDataController {
  static async GetCreditSupplyHistory(marketId: number): Promise<ApiHistoricalData> {
    const historyFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'history', 'credit-supply.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    } else {
      const fullHistory: HistoricalData = ReadJSON(historyFilename);
      const times = Object.values(fullHistory.blockTimes);
      const values = Object.values(fullHistory.values);

      return {
        timestamps: times,
        values: values
      };
    }
  }

  static async GetCreditTotalIssuance(marketId: number): Promise<ApiHistoricalData> {
    const historyFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'history', 'credit-total-issuance.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    } else {
      const fullHistory: HistoricalData = ReadJSON(historyFilename);
      const times = Object.values(fullHistory.blockTimes);
      const values = Object.values(fullHistory.values);

      return {
        timestamps: times,
        values: values
      };
    }
  }

  static async GetAverageInterestRate(marketId: number): Promise<ApiHistoricalData> {
    const historyFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'history', 'average-interest-rate.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    } else {
      const fullHistory: HistoricalData = ReadJSON(historyFilename);
      const times = Object.values(fullHistory.blockTimes);
      const values = Object.values(fullHistory.values);

      return {
        timestamps: times,
        values: values
      };
    }
  }

  static async GetTVL(marketId: number): Promise<ApiHistoricalData> {
    const historyFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'history', 'tvl.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    } else {
      const fullHistory: HistoricalData = ReadJSON(historyFilename);
      const times = Object.values(fullHistory.blockTimes);
      const values = Object.values(fullHistory.values);

      return {
        timestamps: times,
        values: values
      };
    }
  }

  static async GetLoanBorrow(marketId: number): Promise<ApiHistoricalDataMulti> {
    const historyFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'history', 'loan-borrow.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    } else {
      const fullHistory: HistoricalDataMulti = ReadJSON(historyFilename);
      const times = Object.values(fullHistory.blockTimes);

      const multiValues: { [key: string]: number[] } = {
        openLoans: Object.values(fullHistory.values).map((_) => _.openLoans),
        borrowValue: Object.values(fullHistory.values).map((_) => _.borrowValue),
        totalUnpaidInterests: Object.values(fullHistory.values).map((_) => _.totalUnpaidInterests)
      };

      return {
        timestamps: times,
        values: multiValues
      };
    }
  }

  static async GetDebtCeilingIssuance(
    marketId: number,
    termAddress: string
  ): Promise<ApiHistoricalDataMulti | undefined> {
    const historyFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'history', 'debtceiling-issuance.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    } else {
      const fullHistory: HistoricalDataMulti = ReadJSON(historyFilename);
      const keyDebtCeiling = `${termAddress}-debtCeiling`;
      const keyIssuance = `${termAddress}-issuance`;
      const times: number[] = [];
      const multiValues: { [key: string]: number[] } = {
        debtCeiling: [],
        issuance: []
      };

      let termFound = false;

      for (const [blockNumber, blockTimestamp] of Object.entries(fullHistory.blockTimes)) {
        times.push(blockTimestamp);
        const valuesAtBlock = fullHistory.values[Number(blockNumber)];
        if (valuesAtBlock[keyDebtCeiling] != undefined) {
          multiValues.debtCeiling.push(valuesAtBlock[keyDebtCeiling]);
          multiValues.issuance.push(valuesAtBlock[keyIssuance]);
          termFound = true;
        } else {
          // if no value recorded, assume 0 to not have holes in the data
          multiValues.debtCeiling.push(0);
          multiValues.issuance.push(0);
        }
      }

      if (!termFound) {
        return undefined;
      }

      return {
        timestamps: times,
        values: multiValues
      };
    }
  }

  static async GetGaugeWeight(marketId: number, termAddress: string): Promise<ApiHistoricalData | undefined> {
    const historyFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'history', 'gauge-weight.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    } else {
      const fullHistory: HistoricalDataMulti = ReadJSON(historyFilename);
      const keyWeight = `${termAddress}-weight`;

      const returnVal: ApiHistoricalData = {
        timestamps: [],
        values: []
      };

      let termFound = false;

      for (const [blockNumber, blockTimestamp] of Object.entries(fullHistory.blockTimes)) {
        returnVal.timestamps.push(blockTimestamp);
        const valuesAtBlock = fullHistory.values[Number(blockNumber)];
        if (valuesAtBlock[keyWeight] != undefined) {
          returnVal.values.push(valuesAtBlock[keyWeight]);
          termFound = true;
        } else {
          // if no value recorded, assume 0 to not have holes in the data
          returnVal.values.push(0);
        }
      }

      if (!termFound) {
        return undefined;
      }

      return returnVal;
    }
  }

  static async GetSurplusBuffer(marketId: number, termAddress: string): Promise<ApiHistoricalData | undefined> {
    const historyFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'history', 'surplus-buffer.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    } else {
      const fullHistory: HistoricalDataMulti = ReadJSON(historyFilename);
      const keySurplusBuffer = `${termAddress}-surplus-buffer`;

      const returnVal: ApiHistoricalData = {
        timestamps: [],
        values: []
      };

      let termFound = false;

      for (const [blockNumber, blockTimestamp] of Object.entries(fullHistory.blockTimes)) {
        returnVal.timestamps.push(blockTimestamp);
        const valuesAtBlock = fullHistory.values[Number(blockNumber)];
        if (valuesAtBlock[keySurplusBuffer] != undefined) {
          returnVal.values.push(valuesAtBlock[keySurplusBuffer]);
          termFound = true;
        } else {
          // if no value recorded, assume 0 to not have holes in the data
          returnVal.values.push(0);
        }
      }

      if (!termFound) {
        return undefined;
      }

      return returnVal;
    }
  }

  static async GetCreditMultiplierHistory(marketId: number): Promise<ApiHistoricalData> {
    const historyFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'history', 'credit-multiplier.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    } else {
      const fullHistory: HistoricalData = ReadJSON(historyFilename);
      const times = Object.values(fullHistory.blockTimes);
      const values = Object.values(fullHistory.values);

      return {
        timestamps: times,
        values: values
      };
    }
  }
}

export default HistoricalDataController;
