import { ethers } from 'ethers';
import { MulticallWrapper, MulticallProvider } from 'ethers-multicall-provider';
import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import { GetFullConfigFile, ConfigFile, LoadTokens } from '../config/Config';
import { ERC20__factory, GuildToken__factory, LendingTerm__factory } from '../contracts/types';
import { SurplusGuildMinter } from '../contracts/types/SurplusGuildMinter';
import { SurplusGuildMinter__factory } from '../contracts/types/factories/SurplusGuildMinter__factory';
import { LoansFileStructure } from '../model/Loan';
import { ProtocolConstants } from '../model/ProtocolConstants';
import { GLOBAL_DATA_DIR } from '../utils/Constants';
import { GetGaugeForMarketId } from '../utils/ECGHelper';
import { HttpGet } from '../utils/HttpHelper';
import { norm } from '../utils/TokenUtils';
import { ReadJSON, retry, WriteJSON } from '../utils/Utils';
import { GetArchiveWeb3Provider, FetchAllEvents } from '../utils/Web3Helper';
import * as dotenv from 'dotenv';
import { GetTokenPriceMultiAtTimestamp } from '../processors/HistoricalDataFetcher';

dotenv.config();

// Epoch = 2024-05-17 to 2024-06-14
// For epoch 2, the change is to make lender
//  rewards proportional to utilization as you note
// (the calculation I want to use is based on $ value borrowed, so if WETH market has on average 60%
//  of our total borrower value, it gets 60% of the lender rewards). And an adjustment of the per-category breakdown as follows:

// 7M tokens to lenders
// 1M tokens to borrowers
// 1.7M tokens to stakers
// 300k tokens to liquidators

const TARGET_FILENAME = 'aidrop-data-2.json';

const marketSgm: { [marketId: number]: string } = {
  1: '0xB94AaAe7472a694Dd959C8497b2f09730391dc52',
  3: '0x55aB4C8a5f11f8E62d7822d5AEd778784DF12aFD',
  4: '0x6995aA07B177918423d2127B885b67E7A3ceC265'
};

interface AirdropData {
  marketUtilizationUsd: { [dayIso: string]: { [marketId: number]: number } };
  userData: UserDailyData;
}

interface UserDailyData {
  [userAddress: string]: DailyData;
}

interface DailyData {
  userAddress: string;
  dailyBalances: { [dayIso: string]: DayBalance };
}

interface DayBalance {
  [marketId: string]: MarketBalance;
}

interface MarketBalance {
  creditBalanceUsd: number;
  stakedBalanceUsd: number;
  borrowBalanceUsd: number;
}

async function computeAirdropData() {
  const fullConfig = await GetFullConfigFile();
  await LoadTokens();
  const web3ProviderArchival = GetArchiveWeb3Provider();
  const currentBlock = await web3ProviderArchival.getBlockNumber();
  const multicallArchivalProvider = MulticallWrapper.wrap(web3ProviderArchival, 500_000);
  const startDate = new Date(2024, 4, 16, 8, 57, 0);
  const endDate = new Date(2024, 5, 14, 8, 57, 0);
  let currentDate = startDate;
  let blockStart = await getBlockAtTimestamp('arbitrum', Math.round(currentDate.getTime() / 1000));
  const marketAddresses: { [marketId: number]: string[] } = {};

  for (const marketId of Object.keys(fullConfig)) {
    if (Number(marketId) > 1e6) {
      continue;
    }
    const config = fullConfig[Number(marketId)] as ProtocolConstants;

    marketAddresses[Number(marketId)] = await getUniqueAddresses(
      config,
      web3ProviderArchival,
      config.deployBlock - 14400 * 24 * 10, // 10 days before the deploy block
      currentBlock
    );

    console.log('Got ' + marketAddresses[Number(marketId)].length + ' unique addresses for market ' + marketId);
  }

  const fullData: AirdropData = {
    marketUtilizationUsd: {},
    userData: {}
  };

  while (currentDate < endDate) {
    const stopDate = structuredClone(currentDate);
    stopDate.setDate(stopDate.getDate() + 1);
    const blockEnd = await getBlockAtTimestamp('arbitrum', Math.round(currentDate.getTime() / 1000));

    console.log(
      `[${currentDate.toISOString()} - ${stopDate.toISOString()}], block range: [${blockStart} - ${blockEnd}]`
    );

    const dateStr = stopDate.toISOString().split('T')[0];

    // init all addresses with 0 for all markets
    initAllUsersData(marketAddresses, fullData.userData, fullConfig, dateStr);

    const blockToUse = blockEnd; // blockStart + Math.floor(Math.random() * (blockEnd - blockStart + 1));
    for (const marketId of Object.keys(fullConfig)) {
      if (Number(marketId) > 1e6) {
        continue;
      }

      const config = fullConfig[Number(marketId)] as ProtocolConstants;
      if (config.deployBlock > blockToUse) {
        continue; // ignore market if deployed later
      }

      fullData.marketUtilizationUsd[dateStr] = {};
      fullData.marketUtilizationUsd[dateStr][Number(marketId)] = 0;

      // fetch all loans
      const loansFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'loans.json');

      const loansFile: LoansFileStructure = ReadJSON(loansFilename);

      const uniqueAddresses = marketAddresses[Number(marketId)];

      const creditToken = ERC20__factory.connect(config.creditTokenAddress, multicallArchivalProvider);
      console.log('Getting balance of results');
      const balanceOfResults = await retry(
        () => Promise.all(uniqueAddresses.map((_) => creditToken.balanceOf(_, { blockTag: blockToUse }))),
        []
      );

      const guildContract = GuildToken__factory.connect(config.guildTokenAddress, multicallArchivalProvider);
      console.log('Getting live terms');
      const liveTerms = await retry(() => GetGaugeForMarketId(guildContract, Number(marketId), true, blockToUse), []);

      console.log('Getting user stake results');
      const userStakeResults = await retry(getUserStakeResult, [
        marketId,
        multicallArchivalProvider,
        uniqueAddresses,
        liveTerms,
        blockToUse
      ]);

      console.log('Getting loan values');
      const allLoansValue = await retry(
        () =>
          Promise.all(
            loansFile.loans
              // only keep loan on terms that were at the blockToUse block
              .filter((_) => liveTerms.includes(_.lendingTermAddress))
              .map(async (_) => {
                const lendingTermContract = LendingTerm__factory.connect(
                  _.lendingTermAddress,
                  multicallArchivalProvider
                );
                const debt = await lendingTermContract.getLoanDebt(_.id, { blockTag: blockToUse });
                return { borrower: _.borrowerAddress, debt: debt };
              })
          ),
        []
      );

      const blockTimestamp = Math.round(stopDate.getTime() / 1000);
      const pegTokenValue = (
        await GetTokenPriceMultiAtTimestamp(
          [config.pegTokenAddress],
          blockTimestamp,
          blockToUse,
          GetArchiveWeb3Provider()
        )
      )[config.pegTokenAddress];

      if (!pegTokenValue) {
        throw new Error(`Cannot find peg token price at timestamp ${blockTimestamp}`);
      }

      let cursorBalanceOf = 0;
      let cursorStake = 0;
      for (const address of uniqueAddresses) {
        const addressBalancePegToken = balanceOfResults[cursorBalanceOf++];
        let userCreditBalance = 0;

        if (addressBalancePegToken != 0n) {
          userCreditBalance = norm(addressBalancePegToken);
        }

        let totalUserStakeCredit = 0;
        for (const termAddress of liveTerms) {
          const userStakeForTerm = userStakeResults[cursorStake++];
          totalUserStakeCredit += norm(userStakeForTerm.credit);
        }

        let totalUserBorrowValueCredit = 0;
        const userLoans = allLoansValue.filter((_) => _.borrower == address);
        for (const loan of userLoans) {
          totalUserBorrowValueCredit += norm(loan.debt);
        }

        if (!fullData.userData[address]) {
          fullData.userData[address] = {
            userAddress: address,
            dailyBalances: {}
          };
        }

        if (!fullData.userData[address].dailyBalances[dateStr]) {
          fullData.userData[address].dailyBalances[dateStr] = {};
        }

        fullData.userData[address].dailyBalances[dateStr][`market_${marketId}`] = {
          creditBalanceUsd: userCreditBalance * pegTokenValue,
          stakedBalanceUsd: totalUserStakeCredit * pegTokenValue,
          borrowBalanceUsd: totalUserBorrowValueCredit * pegTokenValue
        };

        fullData.marketUtilizationUsd[dateStr][Number(marketId)] +=
          fullData.userData[address].dailyBalances[dateStr][`market_${marketId}`].borrowBalanceUsd;
      }

      WriteJSON(TARGET_FILENAME, fullData);
    }

    WriteJSON(TARGET_FILENAME, fullData);
    blockStart = blockEnd + 1;
    currentDate = stopDate;
  }
  WriteJSON(TARGET_FILENAME, fullData);
}

// Define the interface for the API response
interface BlockResponse {
  height: number;
  timestamp: number;
}

async function getUserStakeResult(
  marketId: string,
  multicallArchivalProvider: MulticallProvider<ethers.JsonRpcProvider>,
  uniqueAddresses: string[],
  liveTerms: string[],
  blockToUse: number
) {
  const surplusGuildMinterContract = SurplusGuildMinter__factory.connect(
    marketSgm[Number(marketId)],
    multicallArchivalProvider
  );
  const userStakePromises: Promise<SurplusGuildMinter.UserStakeStructOutput>[] = [];
  for (const userAddress of uniqueAddresses) {
    for (const termAddress of liveTerms) {
      userStakePromises.push(
        surplusGuildMinterContract.getUserStake(userAddress, termAddress, { blockTag: blockToUse })
      );
    }
  }

  const userStakeResults = await Promise.all(userStakePromises);
  return userStakeResults;
}

function initAllUsersData(
  marketAddresses: { [marketId: number]: string[] },
  fullData: UserDailyData,
  fullConfig: ConfigFile,
  dateStr: string
) {
  for (const addresses of Object.values(marketAddresses)) {
    for (const address of addresses) {
      if (!fullData[address]) {
        fullData[address] = {
          userAddress: address,
          dailyBalances: {}
        };
      }

      for (const marketId of Object.keys(fullConfig)) {
        if (Number(marketId) > 1e6) {
          continue;
        }
        if (!fullData[address].dailyBalances[dateStr]) {
          fullData[address].dailyBalances[dateStr] = {};
        }

        fullData[address].dailyBalances[dateStr][`market_${marketId}`] = {
          creditBalanceUsd: 0,
          stakedBalanceUsd: 0,
          borrowBalanceUsd: 0
        };
      }
    }
  }
}

async function getUniqueAddresses(
  config: ProtocolConstants,
  web3Provider: ethers.JsonRpcProvider,
  startBlock: number,
  endBlock: number
) {
  const creditTokenContract = ERC20__factory.connect(config.creditTokenAddress, web3Provider);
  const creditTransfers = await FetchAllEvents(creditTokenContract, 'credit token', 'Transfer', startBlock, endBlock);
  return Array.from(new Set<string>(creditTransfers.map((_) => _.args.to)));
}

// Function to get the block at a specific timestamp
async function getBlockAtTimestamp(chain: string, timestamp: number): Promise<number> {
  const response = await HttpGet<BlockResponse>(`https://coins.llama.fi/block/${chain}/${timestamp}`);
  return response.height;
}

computeAirdropData();
// airdropDataToCsv();
