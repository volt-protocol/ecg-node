import { BaseContract, ContractEventName, EventLog, JsonRpcProvider, ethers } from 'ethers';
import { sleep } from './Utils';
import { average } from 'simple-statistics';
import axios from 'axios';
import { Log } from './Logger';

/**
 * @param pollingInterval Default 1hour. Used when checking new events, set low (5 or 10 sec) if using web3 provider for reacting to events
 * @returns {JsonRpcProvider}
 */
export function GetWeb3Provider(pollingIntervalMs = 15000): JsonRpcProvider {
  const rpcURL = process.env.RPC_URL;
  if (!rpcURL) {
    throw new Error('Cannot find RPC_URL in env');
  }
  const web3Provider = new JsonRpcProvider(rpcURL, undefined, { staticNetwork: true });
  web3Provider.pollingInterval = pollingIntervalMs;

  return web3Provider;
}

export async function GetBlock(web3Provider: ethers.JsonRpcProvider, blockNumber: number) {
  const block = await web3Provider.getBlock(blockNumber);
  if (!block) {
    throw new Error(`Could not get block data for block ${blockNumber}`);
  } else {
    return block;
  }
}

export async function GetAvgGasPrice(rpcUrl: string) {
  const feeHistoryResponse = await axios.post(rpcUrl, {
    jsonrpc: '2.0',
    method: 'eth_feeHistory',
    params: [10, 'latest', []],
    id: 1
  });

  const results: string[] = feeHistoryResponse.data.result.baseFeePerGas;
  return Math.round(average(results.map((_) => Number(_)))) + 3e9;
}

export async function FetchAllEvents(
  contract: BaseContract,
  contractName: string,
  eventName: string | ContractEventName,
  startBlock: number,
  targetBlock: number,
  blockStepLimit?: number
): Promise<any[]> {
  const extractedArray: any[] = [];

  const initBlockStep = 100_000;
  //Log(`${logPrefix}: will fetch events for ${targetBlock - startBlock + 1} blocks`);
  let blockStep = blockStepLimit && blockStepLimit < initBlockStep ? blockStepLimit : initBlockStep;
  let fromBlock = startBlock;
  let toBlock = 0;
  let cptError = 0;
  while (toBlock < targetBlock) {
    toBlock = fromBlock + blockStep - 1;
    if (toBlock > targetBlock) {
      toBlock = targetBlock;
    }

    let events = undefined;
    try {
      events = await contract.queryFilter(eventName, fromBlock, toBlock);
    } catch (e) {
      // Log(`query filter error: ${e.toString()}`);
      blockStep = Math.round(blockStep / 2);
      if (blockStep < 1000) {
        blockStep = 1000;
      }
      toBlock = 0;
      cptError++;
      if (cptError >= 15) {
        Log(`getPastEvents error: ${e}`);
        throw e;
      }
      await sleep(5000);
      continue;
    }

    if (events.length != 0) {
      for (const e of events) {
        if (e instanceof EventLog) {
          const obj: any = {
            transactionHash: e.transactionHash,
            blockHash: e.blockHash,
            blockNumber: e.blockNumber,
            transactionIndex: e.transactionIndex,
            args: {}
          };
          e.fragment.inputs.forEach(function (paramType, i) {
            obj.args[paramType.name] = e.args[i];
          });
          extractedArray.push(obj);
        } else {
          throw new Error('Log is not EventLog');
        }
      }

      // try to find the blockstep to reach 8000 events per call as the RPC limit is 10 000,
      // this try to change the blockstep by increasing it when the pool is not very used
      // or decreasing it when the pool is very used
      // in any case, should not set the new blockstep to more than 2 times the old one
      const newBlockStep = Math.min(10_000_000, Math.round((blockStep * 8000) / events.length));
      if (newBlockStep > blockStep * 2) {
        blockStep = blockStep * 2;
      } else {
        blockStep = newBlockStep;
      }
    } else {
      // if 0 events, multiply blockstep by 2
      blockStep = blockStep * 2;
    }

    /*Log(
      `${logPrefix}: [${fromBlock} - ${toBlock}] found ${events.length} events after ${cptError} errors (fetched ${
        toBlock - fromBlock + 1
      } blocks). Current results: ${extractedArray.length}`
    );*/

    cptError = 0;
    fromBlock = toBlock + 1;

    if (blockStepLimit && blockStep > blockStepLimit) {
      blockStep = blockStepLimit;
    }
  }

  /*Log(
    `${logPrefix}: found ${extractedArray.length} events in range [${startBlock} ${targetBlock}]`
  );*/
  return extractedArray;
}

export async function FetchAllEventsAndExtractStringArray(
  contract: BaseContract,
  contractName: string,
  eventName: string | ContractEventName,
  argNames: string[],
  startBlock: number,
  targetBlock: number,
  blockStepLimit?: number
): Promise<string[]> {
  const extractedArray: Set<string> = new Set<string>();

  const initBlockStep = 100_000;
  //Log(`${logPrefix}: will fetch events for ${targetBlock - startBlock + 1} blocks`);
  let blockStep = blockStepLimit && blockStepLimit < initBlockStep ? blockStepLimit : initBlockStep;
  let fromBlock = startBlock;
  let toBlock = 0;
  let cptError = 0;
  while (toBlock < targetBlock) {
    toBlock = fromBlock + blockStep - 1;
    if (toBlock > targetBlock) {
      toBlock = targetBlock;
    }

    let events = undefined;
    try {
      events = await contract.queryFilter(eventName, fromBlock, toBlock);
    } catch (e) {
      // Log(`query filter error: ${e.toString()}`);
      blockStep = Math.round(blockStep / 2);
      if (blockStep < 1000) {
        blockStep = 1000;
      }
      toBlock = 0;
      cptError++;
      if (cptError >= 15) {
        Log(`getPastEvents error: ${e}`);
        throw e;
      }
      await sleep(5000);
      continue;
    }

    if (events.length != 0) {
      for (const e of events) {
        if (e instanceof EventLog) {
          for (const argName of argNames) {
            const extractedString = e.args[argName];
            //e[argName].toString();
            extractedArray.add(extractedString);
          }
        } else {
          throw new Error('Log is not EventLog');
        }
      }

      // try to find the blockstep to reach 8000 events per call as the RPC limit is 10 000,
      // this try to change the blockstep by increasing it when the pool is not very used
      // or decreasing it when the pool is very used
      // in any case, should not set the new blockstep to more than 2 times the old one
      const newBlockStep = Math.min(10_000_000, Math.round((blockStep * 8000) / events.length));
      if (newBlockStep > blockStep * 2) {
        blockStep = blockStep * 2;
      } else {
        blockStep = newBlockStep;
      }
    } else {
      // if 0 events, multiply blockstep by 2
      blockStep = blockStep * 2;
    }

    /*Log(
      `${logPrefix}: [${fromBlock} - ${toBlock}] found ${events.length} events after ${cptError} errors (fetched ${
        toBlock - fromBlock + 1
      } blocks). Current results: ${extractedArray.size}`
    );*/

    cptError = 0;
    fromBlock = toBlock + 1;

    if (blockStepLimit && blockStep > blockStepLimit) {
      blockStep = blockStepLimit;
    }
  }

  /*Log(
    `${logPrefix}: found ${extractedArray.size} ${argNames.join(',')} in range [${startBlock} ${targetBlock}]`
  );*/
  return Array.from(extractedArray);
}
