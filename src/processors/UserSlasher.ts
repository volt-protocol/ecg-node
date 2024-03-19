import path from 'path';
import fs from 'fs';
import { GetNodeConfig, ReadJSON, WriteJSON, buildTxUrl, sleep } from '../utils/Utils';
import { GuildToken__factory, Multicall3 } from '../contracts/types';
import { GetGuildTokenAddress } from '../config/Config';
import { ethers } from 'ethers';
import { GaugesFileStructure } from '../model/Gauge';
import { DATA_DIR } from '../utils/Constants';
import { UserSlasherState } from '../model/UserSlasherState';
import { SendNotificationsList } from '../utils/Notifications';
import { GetWeb3Provider } from '../utils/Web3Helper';
import { FileMutex } from '../utils/FileMutex';

const RUN_EVERY_SEC = 600;
const SLASH_DELAY_MS = 12 * 60 * 60 * 1000; // try slashing same user every 12 hours
const STATE_FILENAME = path.join(DATA_DIR, 'processors', 'user-slasher-state.json');

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

    const processorsDataDir = path.join(DATA_DIR, 'processors');

    if (!fs.existsSync(processorsDataDir)) {
      fs.mkdirSync(processorsDataDir, { recursive: true });
    }

    const userSlasherState: UserSlasherState = loadLastState();
    // const multicallContract = Multicall3__factory.connect('0xcA11bde05977b3631167028862bE2a173976CA11', signer);

    const gaugesFilename = path.join(DATA_DIR, 'gauges.json');

    // wait for unlock just before reading data file
    await FileMutex.WaitForUnlock();
    const gaugesFileData: GaugesFileStructure = ReadJSON(gaugesFilename);

    const calls: Multicall3.Call3Struct[] = [];

    const slashMsgfields: { fieldName: string; fieldValue: string }[] = [];
    let slashCounter = 0;
    for (const [gaugeAddress, gauge] of Object.entries(gaugesFileData.gauges)) {
      for (const [gaugeUserAddress, user] of Object.entries(gaugesFileData.gauges[gaugeAddress].users)) {
        if (user.lastLossApplied < gauge.lastLoss && user.weight > BigInt(config.minSizeToSlash) * 1n ** 18n) {
          const userLastState = userSlasherState.gauges[gauge.address]?.users[user.address];
          if (userLastState && userLastState.lastCheckedTimestamp + SLASH_DELAY_MS > Date.now()) {
            console.log(
              `UserSlasher: user ${user.address} for gauge ${gauge.address} was already tried at ${new Date(
                userLastState.lastCheckedTimestamp
              ).toISOString()}`
            );
          } else {
            console.log(`UserSlasher: slashing user ${user.address} for gauge ${gauge.address}`);
            try {
              const web3Provider = GetWeb3Provider();
              const signer = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, web3Provider);
              const guildToken = GuildToken__factory.connect(GetGuildTokenAddress(), signer);
              await guildToken.applyGaugeLoss.staticCall(gauge.address, user.address);
              // if here, the static call does not revert so we can add the applyGaugeLoss to the multicall
              const applyGaugeLossResponse = await guildToken.applyGaugeLoss(gauge.address, user.address);
              await applyGaugeLossResponse.wait();
              slashMsgfields.push({
                fieldName: `${gauge.address} / ${user.address}`,
                fieldValue: buildTxUrl(applyGaugeLossResponse.hash)
              });

              // delete state if successfull slash
              if (userLastState) {
                delete userSlasherState.gauges[gauge.address].users[user.address];
                if (Object.keys(userSlasherState.gauges[gauge.address].users).length == 0) {
                  delete userSlasherState.gauges[gauge.address];
                }
              }
            } catch (e: any) {
              if (!userSlasherState.gauges[gauge.address]) {
                userSlasherState.gauges[gauge.address] = {
                  users: {}
                };
              }

              userSlasherState.gauges[gauge.address].users[user.address] = {
                failReason: e.reason,
                lastCheckedTimestamp: Date.now()
              };

              console.log(`Cannot slash user ${user.address} for gauge ${gauge.address}: ${e.reason}`);

              slashMsgfields.push({
                fieldName: `${gauge.address} / ${user.address}`,
                fieldValue: `Cannot slash -> ${e.reason}`
              });
            }

            slashCounter++;
          }

          // await applyGaugeLossResponse.wait();
          // calls.push({
          //   allowFailure: false,
          //   target: GetGuildTokenAddress(),
          //   callData: guildToken.interface.encodeFunctionData('applyGaugeLoss', [gauge.address, user.address])
          // });

          // slashMsg += `${gauge.address} / ${user.address}: ${buildTxUrl(applyGaugeLossResponse.hash)}\n`;
        }
      }
    }

    // console.log(`UserSlasher: sending ${calls.length} applyGaugeLoss using Multicall3`);
    // do & wait multicall of guildToken.applyGaugeLoss(gauge, user)
    // const multicallResponse = await multicallContract.aggregate3(calls, { gasLimit: slashCounter * 200000 });

    // const receipt = await multicallResponse.wait();

    if (slashCounter > 0) {
      await SendNotificationsList('UserSlasher', `Try/Slashed ${slashCounter} users`, slashMsgfields);
    }

    saveLastState(userSlasherState);
    await sleep(RUN_EVERY_SEC * 1000);
  }
}

function loadLastState(): UserSlasherState {
  if (!fs.existsSync(STATE_FILENAME)) {
    return {
      gauges: {}
    };
  } else {
    return ReadJSON(STATE_FILENAME);
  }
}

function saveLastState(state: UserSlasherState) {
  WriteJSON(STATE_FILENAME, state);
}

UserSlasher();
