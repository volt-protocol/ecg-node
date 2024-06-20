import { JsonRpcProvider, ethers } from 'ethers';
import dotenv from 'dotenv';
import { GetGuildTokenAddress } from '../config/Config';
import { GetListenerWeb3Provider } from '../utils/Web3Helper';
import path from 'path';
import fs from 'fs';
import { LendingTermsFileStructure } from '../model/LendingTerm';
import { DATA_DIR } from '../utils/Constants';
import { ReadJSON } from '../utils/Utils';
import { Log } from '../utils/Logger';
dotenv.config();

let provider: JsonRpcProvider | undefined = undefined;

export async function StartUniversalEventListener() {
  provider = GetListenerWeb3Provider(10000);
  provider.removeAllListeners();
  const guildTokenAddress = await GetGuildTokenAddress();

  const termsFileName = path.join(DATA_DIR, 'terms.json');
  if (!fs.existsSync(termsFileName)) {
    throw new Error(`Could not find file ${termsFileName}`);
  }
  const termsFile: LendingTermsFileStructure = ReadJSON(termsFileName);
  const termsWithDebtCeiling = termsFile.terms.filter((_) => _.debtCeiling != '0').map((_) => _.termAddress);
  Log(`Starting terms listener for ${termsWithDebtCeiling.length}/${termsFile.terms.length} terms`);

  const addresses = [];
  addresses.push(guildTokenAddress);
  addresses.push(...termsWithDebtCeiling);
  provider.on(
    {
      address: addresses
    },
    (event: ethers.Log) => {
      Log(`Receive event from address ${event.address}`);

      if (event.address == guildTokenAddress) {
        Log('Event comes from GUILD');
      } else if (termsWithDebtCeiling.includes(event.address)) {
        Log('Event comes from a TERM');
      }
    }
  );
}

setInterval(() => StartUniversalEventListener(), 30 * 60 * 1000); // restart listener every X minutes

StartUniversalEventListener();
