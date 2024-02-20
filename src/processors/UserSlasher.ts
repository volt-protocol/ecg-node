import path from 'path';
import { GetNodeConfig, ReadJSON, sleep } from '../utils/Utils';
import { GuildToken, GuildToken__factory } from '../contracts/types';
import { GetGuildTokenAddress } from '../config/Config';
import { ethers } from 'ethers';
import { GaugesFileStructure } from '../model/Gauge';
import { DATA_DIR } from '../utils/Constants';
import { readFileSync } from 'node:fs';

const RUN_EVERY_SEC = 300;

/**
 * Slash users with an unapplied loss
 */
async function UserSlasher() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.title = 'USER_SLASHER';
    console.log('UserSlasher: starting');
    const config = GetNodeConfig().processors.USER_SLASHER;

    if (!process.env.RPC_URL) {
      throw new Error('Cannot find RPC_URL in env');
    }
    if (!process.env.ETH_PRIVATE_KEY) {
      throw new Error('Cannot find ETH_PRIVATE_KEY in env');
    }

    const web3Provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const signer = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, web3Provider);
    const guildToken = GuildToken__factory.connect(GetGuildTokenAddress(), signer);

    const gaugesFilename = path.join(DATA_DIR, 'gauges.json');
    const gaugesFileData: GaugesFileStructure = ReadJSON(gaugesFilename);
    for (const [gaugeAddress, gauge] of Object.entries(gaugesFileData.gauges)) {
      for (const [gaugeUserAddress, user] of Object.entries(gaugesFileData.gauges[gaugeAddress].users)) {
        if (user.lastLossApplied < gauge.lastLoss && user.weight > BigInt(config.minSizeToSlash) * 1n ** 18n) {
          console.log('slash', gauge.address, user.address);
          // push a call to guildToken.applyGaugeLoss(gauge, user) in a multicall
        }
      }
    }

    // do & wait multicall of guildToken.applyGaugeLoss(gauge, user)

    await sleep(RUN_EVERY_SEC * 1000);
  }
}

UserSlasher();
