import {
  ApiHistoricalData,
  ApiHistoricalDataMulti,
  HistoricalData,
  HistoricalDataMulti
} from '../../model/HistoricalData';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../../utils/Constants';
import { ReadJSON } from '../../utils/Utils';

const HISTORY_DIR = path.join(DATA_DIR, 'history');
class HistoricalDataController {
  static async GetCreditSupplyHistory(): Promise<ApiHistoricalData> {
    const historyFilename = path.join(HISTORY_DIR, 'credit-supply.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`CANNOT FIND ${historyFilename}`);
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

  static async GetCreditTotalIssuance(): Promise<ApiHistoricalData> {
    const historyFilename = path.join(HISTORY_DIR, 'credit-total-issuance.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`CANNOT FIND ${historyFilename}`);
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

  static async GetAverageInterestRate(): Promise<ApiHistoricalData> {
    const historyFilename = path.join(HISTORY_DIR, 'average-interest-rate.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`CANNOT FIND ${historyFilename}`);
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

  static async GetTVL(): Promise<ApiHistoricalData> {
    const historyFilename = path.join(HISTORY_DIR, 'tvl.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`CANNOT FIND ${historyFilename}`);
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

  static async GetLoanBorrow(): Promise<ApiHistoricalDataMulti> {
    const historyFilename = path.join(HISTORY_DIR, 'loan-borrow.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`CANNOT FIND ${historyFilename}`);
    } else {
      const fullHistory: HistoricalDataMulti = ReadJSON(historyFilename);
      const times = Object.values(fullHistory.blockTimes);

      const multiValues: { [key: string]: number[] } = {
        openLoans: Object.values(fullHistory.values).map((_) => _.openLoans),
        borrowValue: Object.values(fullHistory.values).map((_) => _.borrowValue)
      };

      return {
        timestamps: times,
        values: multiValues
      };
    }
  }

  static async GetDebtCeilingIssuance(termAddress: string): Promise<ApiHistoricalDataMulti | undefined> {
    const historyFilename = path.join(HISTORY_DIR, 'debtceiling-issuance.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`CANNOT FIND ${historyFilename}`);
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

  static async GetGaugeWeight(termAddress: string): Promise<ApiHistoricalData | undefined> {
    const historyFilename = path.join(HISTORY_DIR, 'gauge-weight.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`CANNOT FIND ${historyFilename}`);
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

  static async GetSurplusBuffer(termAddress: string): Promise<ApiHistoricalData | undefined> {
    const historyFilename = path.join(HISTORY_DIR, 'surplus-buffer.json');
    if (!fs.existsSync(historyFilename)) {
      throw new Error(`CANNOT FIND ${historyFilename}`);
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
}

export default HistoricalDataController;
