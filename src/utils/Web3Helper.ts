import {
  BaseContract,
  ContractEventName,
  EventLog,
  Filter,
  Interface,
  JsonRpcProvider,
  TopicFilter,
  ethers
} from 'ethers';
import { sleep } from './Utils';
import { average } from 'simple-statistics';
import { Log } from './Logger';
import { HttpPost } from './HttpHelper';
import { ERC20__factory } from '../contracts/types';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { NETWORK } from './Constants';
import { TokenConfig } from '../model/Config';
const initBlockStep = NETWORK == 'ARBITRUM' ? 500_000 : 100_000;

/**
 * @param pollingInterval Default 500 sec. Used when checking new events, set low (5 or 10 sec) if using web3 provider for reacting to events
 * @returns {JsonRpcProvider}
 */
export function GetArchiveWeb3Provider(pollingIntervalMs = 500_000): JsonRpcProvider {
  const rpcURL = process.env.RPC_URL_ARCHIVE;
  if (!rpcURL) {
    throw new Error('Cannot find RPC_URL_ARCHIVE in env');
  }
  const web3Provider = new JsonRpcProvider(rpcURL, undefined, { staticNetwork: true });
  web3Provider.pollingInterval = pollingIntervalMs;

  return web3Provider;
}

export function GetMulticallProvider(): JsonRpcProvider {
  const multicallLength = process.env.MULTICALL_LENGTH ? Number(process.env.MULTICALL_LENGTH) : 480_000;
  Log(`Using multicall length: ${multicallLength}`);
  const multicallProvider = MulticallWrapper.wrap(GetWeb3Provider(), multicallLength);
  return multicallProvider;
}

/**
 * @param pollingInterval Default 15 sec. Used when checking new events, set low (5 or 10 sec) if using web3 provider for reacting to events
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
/**
 * @param pollingInterval Default 15 sec. Used when checking new events, set low (5 or 10 sec) if using web3 provider for reacting to events
 * @returns {JsonRpcProvider}
 */
export function GetL1Web3Provider(pollingIntervalMs = 15000): JsonRpcProvider {
  if (NETWORK != 'ARBITRUM') {
    return GetWeb3Provider(pollingIntervalMs);
  }

  const rpcURL = process.env.RPC_URL_L1;
  if (!rpcURL) {
    throw new Error('Cannot find RPC_URL_L1 in env');
  }
  const web3Provider = new JsonRpcProvider(rpcURL, undefined, { staticNetwork: true });
  web3Provider.pollingInterval = pollingIntervalMs;

  return web3Provider;
}

/**
 * @param pollingInterval Default 1hour. Used when checking new events, set low (5 or 10 sec) if using web3 provider for reacting to events
 * @returns {JsonRpcProvider}
 */
export function GetListenerWeb3Provider(pollingIntervalMs = 15000): JsonRpcProvider {
  let rpcURL = process.env.RPC_URL_LISTENER;
  if (!rpcURL) {
    // if no RPC_URL_LISTENER in env, try with normal RPC_URL
    rpcURL = process.env.RPC_URL;
    if (!rpcURL) {
      throw new Error('Cannot find RPC_URL_LISTENER or RPC_URL in env');
    }
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

/**
 * Returns the avg gas price in wei
 * @param rpcUrl the RPC url
 * @returns avg gas price in wei
 */
export async function GetAvgGasPrice() {
  const rpcURL = process.env.RPC_URL;
  if (!rpcURL) {
    throw new Error('Cannot find RPC_URL in env');
  }

  interface feeHistory {
    jsonrpc: string;
    id: number;
    result: Result;
  }

  interface Result {
    baseFeePerGas: string[];
    gasUsedRatio: number[];
    oldestBlock: string;
    reward: string[][];
  }

  const feeHistoryResponse = await HttpPost<feeHistory>(rpcURL, {
    jsonrpc: '2.0',
    method: 'eth_feeHistory',
    params: [10, 'latest', []],
    id: 1
  });

  const results: string[] = feeHistoryResponse.result.baseFeePerGas;
  const avgGasPriceWei = BigInt(Math.round(average(results.map((_) => Number(_)))));

  return avgGasPriceWei;
}

export interface DefaultLog {
  logName: string;
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
  transactionIndex: number;
  address: string;
  args: { [argName: string]: any };
}
export async function FetchAllEventsMulti(
  contractInterface: Interface,
  addresses: string[],
  topics: TopicFilter,
  startBlock: number,
  targetBlock: number,
  web3Provider: JsonRpcProvider,
  blockStepLimit?: number
): Promise<DefaultLog[]> {
  const extractedArray: DefaultLog[] = [];
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

    const filter: Filter = {
      address: addresses,
      topics: topics,
      fromBlock: fromBlock,
      toBlock: toBlock
    };

    let events = undefined;
    try {
      events = await web3Provider.getLogs(filter);
    } catch (e) {
      Log('multi query filter error:', e);

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
      for (const log of events) {
        const e = contractInterface.parseLog({ data: log.data, topics: log.topics.map((_) => _.toString()) });
        if (!e) {
          throw new Error('Cannot parse log');
        }
        const obj: DefaultLog = {
          transactionHash: log.transactionHash,
          blockHash: log.blockHash,
          blockNumber: log.blockNumber,
          transactionIndex: log.transactionIndex,
          address: log.address,
          args: {},
          logName: e.name
        };
        e.fragment.inputs.forEach(function (paramType, i) {
          obj.args[paramType.name] = e.args[i];
        });
        extractedArray.push(obj);
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

export async function FetchAllEvents(
  contract: BaseContract,
  contractName: string,
  eventName: string | ContractEventName,
  startBlock: number,
  targetBlock: number,
  blockStepLimit?: number
): Promise<DefaultLog[]> {
  const extractedArray: DefaultLog[] = [];

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
      Log('all query filter error:', e);

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
          const logParsed = contract.interface.parseLog({ data: e.data, topics: e.topics.map((_) => _.toString()) });
          if (!logParsed) {
            throw new Error('Cannot parse event');
          }
          const obj: DefaultLog = {
            transactionHash: e.transactionHash,
            blockHash: e.blockHash,
            blockNumber: e.blockNumber,
            transactionIndex: e.transactionIndex,
            address: e.address,
            args: {},
            logName: logParsed.name
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

  const logPrefix = `${contractName}`;
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
      Log('query filter error:', e);
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

    // Log(
    //   `${logPrefix}: [${fromBlock} - ${toBlock}] found ${events.length} events after ${cptError} errors (fetched ${
    //     toBlock - fromBlock + 1
    //   } blocks). Current results: ${extractedArray.size}`
    // );

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

export async function GetERC20Infos(web3Provider: JsonRpcProvider, tokenAddress: string): Promise<TokenConfig> {
  const erc20Contract = ERC20__factory.connect(tokenAddress, MulticallWrapper.wrap(web3Provider));
  const erc20Data = await Promise.all([erc20Contract.symbol(), erc20Contract.name(), erc20Contract.decimals()]);

  return {
    address: tokenAddress,
    symbol: erc20Data[0],
    permitAllowed: false,
    decimals: Number(erc20Data[2]),
    protocolToken: false
  };
}
