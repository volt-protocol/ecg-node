import { ApiHistoricalData, HistoricalData } from '../../model/HistoricalData';
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
}

export default HistoricalDataController;
