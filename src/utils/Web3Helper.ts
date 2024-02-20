import { BaseContract, ContractEventName, EventLog, ethers } from 'ethers';
import { sleep } from './Utils';
import { average } from 'simple-statistics';
import axios from 'axios';

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

/*export async function SignPermit(
  signer: ethers.Wallet,
  chainId: number,
  erc20Name: string,
  contractAddress: string,
  spenderAddress: string,
  amount: string,
  nonce: string,
  deadline: number,
  version = '1'
) {
  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }
    ]
  };

  const domainData = {
    name: erc20Name,
    version: version ?? '1',
    chainId: chainId,
    verifyingContract: contractAddress
  };

  const message = {
    owner: signer.address,
    spender: spenderAddress,
    value: amount,
    nonce,
    deadline
  };

  const signature = await signer.signTypedData(domainData, types, message);

  const splitSign = ethers.Signature.from(signature);
  // Append signature and related data to the final array
  signedRiskDatas.push({
    r: splitSign.r,
    s: splitSign.s,
    v: splitSign.v,
    liquidationBonus: parameter.bonus,
    riskData: typedData.value
  });
  const [r, s, v] = [slice(signature, 0, 32), slice(signature, 32, 64), slice(signature, 64, 65)];
  return { r, s, v: hexToNumber(v), deadline: deadline };
}*/

export async function FetchAllEvents(
  contract: BaseContract,
  contractName: string,
  eventName: string | ContractEventName,
  startBlock: number,
  targetBlock: number,
  blockStepLimit?: number
): Promise<any[]> {
  const extractedArray: any[] = new Array();
  const logPrefix = `fetchAllEvents[${contractName}-${eventName}-all]`;

  const initBlockStep = 100_000;
  //console.log(`${logPrefix}: will fetch events for ${targetBlock - startBlock + 1} blocks`);
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
      // console.log(`query filter error: ${e.toString()}`);
      blockStep = Math.round(blockStep / 2);
      if (blockStep < 1000) {
        blockStep = 1000;
      }
      toBlock = 0;
      cptError++;
      if (cptError >= 15) {
        console.log(`getPastEvents error: ${e}`);
        throw e;
      }
      await sleep(5000);
      continue;
    }

    if (events.length != 0) {
      for (const e of events) {
        if (e instanceof EventLog) {
          let obj: any = {
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

    /*console.log(
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

  /*console.log(
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
  const logPrefix = `fetchAllEvents[${contractName}-${eventName}-${argNames.join(',')}]`;

  const initBlockStep = 100_000;
  //console.log(`${logPrefix}: will fetch events for ${targetBlock - startBlock + 1} blocks`);
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
      // console.log(`query filter error: ${e.toString()}`);
      blockStep = Math.round(blockStep / 2);
      if (blockStep < 1000) {
        blockStep = 1000;
      }
      toBlock = 0;
      cptError++;
      if (cptError >= 15) {
        console.log(`getPastEvents error: ${e}`);
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

    /*console.log(
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

  /*console.log(
    `${logPrefix}: found ${extractedArray.size} ${argNames.join(',')} in range [${startBlock} ${targetBlock}]`
  );*/
  return Array.from(extractedArray);
}
