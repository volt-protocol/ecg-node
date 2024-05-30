import { existsSync } from 'fs';
import LendingTerm, { LendingTermStatus, LendingTermsFileStructure } from '../model/LendingTerm';
import { GetNodeConfig, GetProtocolData, ReadJSON, WaitUntilScheduled, buildTxUrl, sleep } from '../utils/Utils';
import path from 'path';
import { DATA_DIR, NETWORK } from '../utils/Constants';
import {
  GetLendingTermOffboardingAddress,
  GetPegTokenAddress,
  LoadConfiguration,
  getTokenByAddress,
  getTokenByAddressNoError
} from '../config/Config';
import { norm } from '../utils/TokenUtils';
import { TermOffboarderConfig } from '../model/NodeConfig';
import { LendingTermOffboarding__factory } from '../contracts/types';
import { ethers } from 'ethers';
import { SendNotifications, SendNotificationsList } from '../utils/Notifications';
import { GetERC20Infos, GetWeb3Provider } from '../utils/Web3Helper';
import { FileMutex } from '../utils/FileMutex';
import { Log, Warn } from '../utils/Logger';
import PriceService from '../services/price/PriceService';

const RUN_EVERY_SEC = 60 * 5;

TermOffboarder();

async function TermOffboarder() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // load external config
    await LoadConfiguration();
    const startDate = Date.now();
    const offboarderConfig = GetNodeConfig().processors.TERM_OFFBOARDER;

    process.title = 'ECG_NODE_TERM_OFFBOARDER';
    Log('starting');
    const termsFilename = path.join(DATA_DIR, 'terms.json');
    if (!existsSync(termsFilename)) {
      throw new Error('Cannot start TERM OFFBOARDER without terms file. please sync protocol data');
    }

    if (!process.env.ETH_PRIVATE_KEY) {
      throw new Error('Cannot find ETH_PRIVATE_KEY in env');
    }

    const rpcURL = process.env.RPC_URL;
    if (!rpcURL) {
      throw new Error('Cannot find RPC_URL in env');
    }

    // wait for unlock just before reading data file
    await FileMutex.WaitForUnlock();
    const termFileData: LendingTermsFileStructure = ReadJSON(termsFilename);
    for (const term of termFileData.terms.filter((_) => _.status == LendingTermStatus.LIVE)) {
      const checkTermReponse = await checkTermForOffboard(term, offboarderConfig);
      if (checkTermReponse.termMustBeOffboarded) {
        if (!offboarderConfig.onlyLogging) {
          Log(`[${term.label}]: TERM NEEDS TO BE OFFBOARDED`);
          const web3Provider = GetWeb3Provider();
          await offboardProcess(web3Provider, term, offboarderConfig.performCleanup, checkTermReponse.reason);
        } else {
          Log(`[${term.label}]: TERM NEEDS TO BE OFFBOARDED, but 'onlyLogging' is enabled`);
        }
      } else {
        Log(`[${term.label}]: Term is healthy`);
      }
    }
    Log('Ending');

    await WaitUntilScheduled(startDate, RUN_EVERY_SEC);
  }
}

async function checkTermForOffboard(
  term: LendingTerm,
  offboarderConfig: TermOffboarderConfig
): Promise<{ termMustBeOffboarded: boolean; reason: string }> {
  let collateralToken = getTokenByAddressNoError(term.collateralAddress);
  if (!collateralToken) {
    collateralToken = {
      address: term.collateralAddress,
      decimals: term.collateralDecimals,
      symbol: term.collateralSymbol,
      permitAllowed: false,
      protocolToken: false
    };
    Warn(
      `Token ${term.collateralAddress} not found in config. ERC20 infos: ${collateralToken.symbol} / ${collateralToken.decimals} decimals`
    );
  }

  const collateralRealPrice = await PriceService.GetTokenPrice(
    collateralToken.mainnetAddress || collateralToken.address
  );
  if (!collateralRealPrice) {
    Warn(`Cannot find price for ${collateralToken.mainnetAddress || collateralToken.address}. ASSUMING HEALTHY`);
    return {
      termMustBeOffboarded: false,
      reason: `Cannot find price for ${collateralToken.mainnetAddress || collateralToken.address}. ASSUMING HEALTHY`
    };
  }
  const pegToken = getTokenByAddress(GetPegTokenAddress());
  const pegTokenRealPrice = await PriceService.GetTokenPrice(pegToken.mainnetAddress || pegToken.address);
  if (!pegTokenRealPrice) {
    Warn(`Cannot find price for ${pegToken.mainnetAddress || pegToken.address}`);
    return {
      termMustBeOffboarded: false,
      reason: `Cannot find price for ${pegToken.mainnetAddress || pegToken.address}`
    };
  }

  Log(
    `[${term.label}]: ${collateralToken.symbol} price: ${collateralRealPrice} / PegToken price: ${pegTokenRealPrice}`
  );
  const normBorrowRatio = norm(term.maxDebtPerCollateralToken, 36 - collateralToken.decimals);
  Log(`[${term.label}]: borrow ratio: ${normBorrowRatio} ${pegToken.symbol} / ${collateralToken.symbol}`);

  // find the min overcollateralization config for this token
  let minOvercollateralization = offboarderConfig.defaultMinOvercollateralization;
  if (offboarderConfig.tokens[collateralToken.symbol]) {
    minOvercollateralization = offboarderConfig.tokens[collateralToken.symbol].minOvercollateralization;
  }

  const currentOvercollateralization = collateralRealPrice / pegTokenRealPrice / normBorrowRatio;
  Log(
    `[${term.label}]: current overcollateralization: ${currentOvercollateralization}, min: ${minOvercollateralization}`
  );

  if (currentOvercollateralization < minOvercollateralization) {
    return {
      termMustBeOffboarded: true,
      reason: `Current overcollateralization: ${currentOvercollateralization}, min: ${minOvercollateralization}. Collateral price: $${collateralRealPrice} / pegToken price: $${pegTokenRealPrice}. Borrow ratio: ${normBorrowRatio}`
    };
  } else {
    return {
      termMustBeOffboarded: false,
      reason: 'Term healthy'
    };
  }
}

async function offboardProcess(
  web3Provider: ethers.JsonRpcProvider,
  term: LendingTerm,
  performCleanup: boolean | undefined,
  reason: string
) {
  if (!process.env.ETH_PRIVATE_KEY) {
    throw new Error('Cannot find ETH_PRIVATE_KEY in env');
  }

  const signer = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, web3Provider);

  const lendingTermOffboardingContract = LendingTermOffboarding__factory.connect(
    GetLendingTermOffboardingAddress(),
    signer
  );

  const nodeAddress = signer.address;

  let pollBlock = Number(await lendingTermOffboardingContract.lastPollBlock(term.termAddress));

  // 0 or 1 mean no offboard in progress for this term
  if (pollBlock < 2) {
    // propose offboard

    const proposeResponse = await lendingTermOffboardingContract.proposeOffboard(term.termAddress);
    await SendNotificationsList(
      'Term Offboarder',
      `Created Offboard proposal on term ${term.label} ${term.termAddress}`,
      [
        {
          fieldName: 'Tx',
          fieldValue: `${buildTxUrl(proposeResponse.hash)}`
        },
        {
          fieldName: 'Reason',
          fieldValue: reason
        }
      ]
    );
    await proposeResponse.wait();

    // here, the offboard proposal should have been created, find it by block
    pollBlock = Number(await lendingTermOffboardingContract.lastPollBlock(term.termAddress));
    if (NETWORK == 'ARBITRUM') {
      await sleep(15000); // wait 15 sec after offboarding to avoid "ERC20MultiVotes: not a past block" error
    }
  }

  // check if the node already voted for it
  const alreadyVotedWeight = await lendingTermOffboardingContract.userPollVotes(
    nodeAddress,
    pollBlock,
    term.termAddress
  );

  if (alreadyVotedWeight > 0n) {
    // already voted, do nothing
  } else {
    const supportResponse = await lendingTermOffboardingContract.supportOffboard(pollBlock, term.termAddress);
    await supportResponse.wait();
    await SendNotificationsList('Term Offboarder', `Supported Offboard term ${term.label} ${term.termAddress}`, [
      {
        fieldName: 'Tx',
        fieldValue: `${buildTxUrl(supportResponse.hash)}`
      },
      {
        fieldName: 'Reason',
        fieldValue: reason
      }
    ]);
  }

  /*enum OffboardStatus {
        UNSET,
        CAN_OFFBOARD,
        CAN_CLEANUP
    }*/
  let canOffboard = await lendingTermOffboardingContract.canOffboard(term.termAddress);

  if (canOffboard == 1n) {
    const offboardResp = await lendingTermOffboardingContract.offboard(term.termAddress);
    await offboardResp.wait();
    await SendNotificationsList('Term Offboarder', `Offboarded term ${term.label} ${term.termAddress}`, [
      {
        fieldName: 'Tx',
        fieldValue: `${buildTxUrl(offboardResp.hash)}`
      },
      {
        fieldName: 'Reason',
        fieldValue: reason
      }
    ]);

    canOffboard = await lendingTermOffboardingContract.canOffboard(term.termAddress);
  }

  if (canOffboard == 2n && performCleanup) {
    const cleanupResp = await lendingTermOffboardingContract.cleanup(term.termAddress);
    await cleanupResp.wait();

    await SendNotifications(
      'Term Offboarder',
      `Cleaned up term ${term.label} ${term.termAddress}`,
      `Tx: ${buildTxUrl(cleanupResp.hash)}`
    );
  }
}
