import { existsSync } from 'fs';
import LendingTerm, { LendingTermStatus, LendingTermsFileStructure } from '../model/LendingTerm';
import { GetNodeConfig, GetProtocolData, ReadJSON, WaitUntilScheduled, buildTxUrl } from '../utils/Utils';
import path from 'path';
import { DATA_DIR } from '../utils/Constants';
import { GetTokenPrice } from '../utils/Price';
import { GetLendingTermOffboardingAddress, getTokenByAddress, getTokenBySymbol } from '../config/Config';
import { norm } from '../utils/TokenUtils';
import { TermOffboarderConfig } from '../model/NodeConfig';
import { LendingTermOffboarding__factory } from '../contracts/types';
import { ethers } from 'ethers';
import { SendNotifications } from '../utils/Notifications';
import { GetWeb3Provider } from '../utils/Web3Helper';
import { FileMutex } from '../utils/FileMutex';

const RUN_EVERY_SEC = 60 * 5;
const web3Provider = GetWeb3Provider();

TermOffboarder();

async function TermOffboarder() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const startDate = Date.now();
    const offboarderConfig = GetNodeConfig().processors.TERM_OFFBOARDER;

    process.title = 'TERM_OFFBOARDER';
    console.log('TermOffboarder: starting');
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
      const termMustBeOffboarded = await checkTermForOffboard(term, offboarderConfig);
      if (termMustBeOffboarded) {
        console.log(`TermOffboarder[${term.label}]: TERM NEEDS TO BE OFFBOARDED`);
        await offboardProcess(web3Provider, term, offboarderConfig.performCleanup);
      } else {
        console.log(`TermOffboarder[${term.label}]: Term is healthy`);
      }
    }
    console.log('TermOffboarder: Ending');

    await WaitUntilScheduled(startDate, RUN_EVERY_SEC);
  }
}

async function checkTermForOffboard(term: LendingTerm, offboarderConfig: TermOffboarderConfig) {
  const collateralToken = getTokenByAddress(term.collateralAddress);
  const collateralRealPrice = await GetTokenPrice(collateralToken.mainnetAddress || collateralToken.address);
  const pegToken = getTokenBySymbol('USDC');
  const pegTokenRealPrice = await GetTokenPrice(pegToken.mainnetAddress || pegToken.address);
  console.log(`TermOffboarder[${term.label}]: ${collateralToken.symbol} price: ${collateralRealPrice}`);
  const normBorrowRatio = norm(term.borrowRatio) * norm(GetProtocolData().creditMultiplier);
  console.log(
    `TermOffboarder[${term.label}]: borrow ratio: ${normBorrowRatio} ${pegToken.symbol} / ${collateralToken.symbol}`
  );

  // find the min overcollateralization config for this token
  const tokenConfig = offboarderConfig.tokens[collateralToken.symbol];
  if (!tokenConfig) {
    console.warn(`TermOffboarder: Cannot find ${collateralToken.symbol} in offboarder config`);
    return false;
  }

  const currentOvercollateralization = collateralRealPrice / pegTokenRealPrice / normBorrowRatio;
  console.log(
    `TermOffboarder[${term.label}]: current overcollateralization: ${currentOvercollateralization}, min: ${tokenConfig.minOvercollateralization}`
  );

  if (currentOvercollateralization < tokenConfig.minOvercollateralization) {
    return true;
  } else {
    return false;
  }
}

async function offboardProcess(
  web3Provider: ethers.JsonRpcProvider,
  term: LendingTerm,
  performCleanup: boolean | undefined
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
    await SendNotifications(
      'Term Offboarder',
      `Created Offboard proposal on term ${term.label} ${term.termAddress}`,
      `Tx: ${buildTxUrl(proposeResponse.hash)}`
    );
    await proposeResponse.wait();

    // here, the offboard proposal should have been created, find it by block
    pollBlock = Number(await lendingTermOffboardingContract.lastPollBlock(term.termAddress));
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

    await SendNotifications(
      'Term Offboarder',
      `Supported Offboard term ${term.label} ${term.termAddress}`,
      `Tx: ${buildTxUrl(supportResponse.hash)}`
    );
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

    await SendNotifications(
      'Term Offboarder',
      `Offboarded term ${term.label} ${term.termAddress}`,
      `Tx: ${buildTxUrl(offboardResp.hash)}`
    );

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
