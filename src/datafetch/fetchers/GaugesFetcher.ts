import { JsonRpcProvider } from 'ethers';
import { GetDeployBlock, GetGuildTokenAddress } from '../../config/Config';
import fs from 'fs';
import { GuildToken__factory } from '../../contracts/types';
import { DATA_DIR } from '../../utils/Constants';
import path from 'path';
import { ReadJSON, WriteJSON } from '../../utils/Utils';
import { Log } from '../../utils/Logger';
import { SyncData } from '../../model/SyncData';
import { FetchAllEvents } from '../../utils/Web3Helper';
import { GaugesFileStructure } from '../../model/Gauge';

export default class GaugesFetcher {
  static async fetchAndSaveGauges(web3Provider: JsonRpcProvider, syncData: SyncData, currentBlock: number) {
    Log('FetchECGData[Gauges]: starting');
    let sinceBlock = GetDeployBlock();
    if (syncData.gaugeSync) {
      sinceBlock = syncData.gaugeSync.lastBlockFetched + 1;
    } else {
      // if no gaugeSync, delete gauges.json if any
      if (fs.existsSync(path.join(DATA_DIR, 'gauges.json'))) {
        fs.rmSync(path.join(DATA_DIR, 'gauges.json'));
      }
    }

    // load existing gauges from file if it exists
    let gaugesFile: GaugesFileStructure = {
      gauges: {},
      updated: Date.now(),
      updatedHuman: new Date(Date.now()).toISOString()
    };
    const gaugesFilePath = path.join(DATA_DIR, 'gauges.json');
    if (fs.existsSync(gaugesFilePath)) {
      gaugesFile = ReadJSON(gaugesFilePath);
    }

    // fetch & handle data
    const guild = GuildToken__factory.connect(GetGuildTokenAddress(), web3Provider);
    // IncrementGaugeWeight(user, gauge, weight)
    const incrementGaugeEvents = await FetchAllEvents(
      guild,
      'GuildToken',
      'IncrementGaugeWeight',
      sinceBlock,
      currentBlock
    );
    for (const event of incrementGaugeEvents) {
      {
        gaugesFile.gauges[event.args.gauge] = gaugesFile.gauges[event.args.gauge] || {
          address: event.args.gauge,
          weight: 0n,
          lastLoss: 0,
          users: {}
        };
        gaugesFile.gauges[event.args.gauge].weight += event.args.weight;

        if (!gaugesFile.gauges[event.args.gauge].users[event.args.user]) {
          const block = await web3Provider.getBlock(event.blockNumber);
          if (!block) {
            throw new Error(`Cannot getBlock for ${event.blockNumber}`);
          }
          gaugesFile.gauges[event.args.gauge].users[event.args.user] = {
            address: event.args.user,
            weight: 0n,
            lastLossApplied: block.timestamp // default timestamp when incrementing gauge is block.timestamp
          };
        }

        gaugesFile.gauges[event.args.gauge].users[event.args.user].weight += event.args.weight;
      }
    }

    // DecrementGaugeWeight(user, gauge, weight)
    (await FetchAllEvents(guild, 'GuildToken', 'DecrementGaugeWeight', sinceBlock, currentBlock)).forEach((event) => {
      gaugesFile.gauges[event.args.gauge].weight -= event.args.weight;

      gaugesFile.gauges[event.args.gauge].users[event.args.user].weight -= event.args.weight;
    });

    // GaugeLoss(gauge, when)
    (await FetchAllEvents(guild, 'GuildToken', 'GaugeLoss', sinceBlock, currentBlock)).forEach((event) => {
      gaugesFile.gauges[event.args.gauge].lastLoss = Number(event.args.when);
    });
    // GaugeLossApply(gauge, who, weight, when)
    (await FetchAllEvents(guild, 'GuildToken', 'GaugeLossApply', sinceBlock, currentBlock)).forEach((event) => {
      gaugesFile.gauges[event.args.gauge].users[event.args.who].lastLossApplied = Number(event.args.when);
    });

    gaugesFile.updated = Date.now();
    gaugesFile.updatedHuman = new Date().toISOString();
    WriteJSON(gaugesFilePath, gaugesFile);

    // save sync data
    syncData.gaugeSync = syncData.gaugeSync || {
      lastBlockFetched: 0
    };
    syncData.gaugeSync.lastBlockFetched = currentBlock;

    Log(`FetchECGData[Gauges]: Updated ${Object.keys(gaugesFile.gauges).length} gauges`);
  }
}
