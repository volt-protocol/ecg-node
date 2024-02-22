import path from 'path';
import { GetNodeConfig, ReadJSON, buildTxUrl, sleep } from '../utils/Utils';
import { GuildToken, GuildToken__factory, Multicall3, Multicall3__factory } from '../contracts/types';
import { GetGuildTokenAddress } from '../config/Config';
import { ethers } from 'ethers';
import { GaugesFileStructure } from '../model/Gauge';
import { DATA_DIR } from '../utils/Constants';
import { readFileSync } from 'node:fs';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { SendTelegramMessage } from '../utils/TelegramHelper';

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
    const multicallContract = Multicall3__factory.connect('0xcA11bde05977b3631167028862bE2a173976CA11', signer);

    const gaugesFilename = path.join(DATA_DIR, 'gauges.json');
    const gaugesFileData: GaugesFileStructure = ReadJSON(gaugesFilename);

    const calls: Multicall3.Call3Struct[] = [];

    let slashMsg = '';
    let slashCounter = 0;
    for (const [gaugeAddress, gauge] of Object.entries(gaugesFileData.gauges)) {
      for (const [gaugeUserAddress, user] of Object.entries(gaugesFileData.gauges[gaugeAddress].users)) {
        if (user.lastLossApplied < gauge.lastLoss && user.weight > BigInt(config.minSizeToSlash) * 1n ** 18n) {
          console.log(`UserSlasher: slashing user ${user.address} for gauge ${gauge.address}`);
          // push a call to guildToken.applyGaugeLoss(gauge, user) in a multicall
          const applyGaugeLossResponse = await guildToken.applyGaugeLoss(gauge.address, user.address);
          await applyGaugeLossResponse.wait();
          // calls.push({
          //   allowFailure: false,
          //   target: GetGuildTokenAddress(),
          //   callData: guildToken.interface.encodeFunctionData('applyGaugeLoss', [gauge.address, user.address])
          // });

          slashMsg += `${gauge.address} / ${user.address}: ${buildTxUrl(applyGaugeLossResponse.hash)}\n`;
          slashCounter++;
        }
      }
    }

    console.log(`UserSlasher: sending ${calls.length} applyGaugeLoss using Multicall3`);
    // do & wait multicall of guildToken.applyGaugeLoss(gauge, user)
    // const multicallResponse = await multicallContract.aggregate3(calls, { gasLimit: slashCounter * 200000 });

    // const receipt = await multicallResponse.wait();

    await SendTelegramMessage(`[User Slasher] Slashed ${slashCounter} users:\n` + 'GAUGE / USER\n' + slashMsg, false);

    await sleep(RUN_EVERY_SEC * 1000);
  }
}

UserSlasher();
