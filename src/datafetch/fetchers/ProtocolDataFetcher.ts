import { JsonRpcProvider } from 'ethers';
import { ProtocolData, ProtocolDataFileStructure } from '../../model/ProtocolData';
import { GetProfitManagerAddress } from '../../config/Config';
import { ProfitManager__factory } from '../../contracts/types';
import { DATA_DIR } from '../../utils/Constants';
import path from 'path';
import { WriteJSON } from '../../utils/Utils';

export default class ProtocolDataFetcher {
  static async fetchAndSaveProtocolData(web3Provider: JsonRpcProvider): Promise<ProtocolData> {
    const profitManagerContract = ProfitManager__factory.connect(await GetProfitManagerAddress(), web3Provider);
    const creditMultiplier = await profitManagerContract.creditMultiplier();

    const data: ProtocolData = {
      creditMultiplier: creditMultiplier
    };

    const protocolDataPath = path.join(DATA_DIR, 'protocol-data.json');
    const fetchDate = Date.now();
    const protocolFileData: ProtocolDataFileStructure = {
      updated: fetchDate,
      updatedHuman: new Date(fetchDate).toISOString(),
      data: data
    };

    WriteJSON(protocolDataPath, protocolFileData);

    return data;
  }
}
