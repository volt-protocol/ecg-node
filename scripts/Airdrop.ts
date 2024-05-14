import { ConfigFile, GetFullConfigFile } from '../src/config/Config';
import { FetchAllEvents, GetArchiveWeb3Provider, GetWeb3Provider } from '../src/utils/Web3Helper';
import { GuildToken__factory } from '../src/contracts/types/factories/GuildToken__factory';
import { LendingTermOnboarding__factory } from '../src/contracts/types/factories/LendingTermOnboarding__factory';
import { LendingTermFactory__factory } from '../src/contracts/types/factories/LendingTermFactory__factory';
import { LendingTerm__factory } from '../src/contracts/types/factories/LendingTerm__factory';
import { ERC20__factory } from '../src/contracts/types/factories/ERC20__factory';
import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import { ReadJSON, WriteJSON, sleep } from '../src/utils/Utils';
import { HttpGet } from '../src/utils/HttpHelper';
import { BLOCK_PER_HOUR, GLOBAL_DATA_DIR } from '../src/utils/Constants';
import { CreditTransferFile } from '../src/model/CreditTransfer';
import path from 'path';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { GetTokenPriceAtTimestamp } from '../src/utils/Price';
import { norm } from '../src/utils/TokenUtils';
import { ProtocolConstants } from '../src/model/ProtocolConstants';
import { GetGaugeForMarketId } from '../src/utils/ECGHelper';
import { SurplusGuildMinter__factory } from '../src/contracts/types';
import { SurplusGuildMinter } from '../src/contracts/types/SurplusGuildMinter';
import { LoansFileStructure } from '../src/model/Loan';
import { writeFileSync } from 'fs';

dotenv.config();

// Epoch = 2024-04-19 to 2024-05-17 (28 days)
// Reward over epoch : 10M
// Rewards per day : 357,143 GUILD
// Rewards for lenders : 60%
// Rewards for borrowers : 20%
// Rewards for stakers : 15%
// Rewards for liquidators : 5%

// Daily stats to collect for every address that ever interacted with the protocol :
// - Avg gUSDC-1 balance -> convert to $
// - Avg gWETH-3 balance -> convert to $
// - Avg gARB-4 balance -> convert to $
// - Avg gUSDC-1 staked in SGM -> convert to $
// - Avg gWETH-3 staked in SGM -> convert to $
// - Avg gARB-4 staked in SGM -> convert to $
// - Avg borrow $ value

// Then, daily :
// - for each user, if sum(avg credit balances) + sum (avg staked) > sum (avg borrow value), type = lender, else type = borrower
// - for each user, if type = lender, totalLenders += sum(avg credit balances) + sum (avg staked)
// - for each user, if type = borrower, totalLenders += sum(avg credit balances)
// - for each user, totalBorrowers += sum(avg borrow value)
// - for each user, totalStakers += sum (avg staked)
// - lender airdrop = (sum(avg credit balances) + sum (avg staked)) / totalLenders * 60% * 357143
// - borrower airdrop = sum (avg borrow value) / totalBorrowers * 20% * 357143
// - staker airdrop = sum (avg staked) / totalStakers * 15% * 357143

const marketSgm: { [marketId: number]: string } = {
  1: '0xb94aaae7472a694dd959c8497b2f09730391dc52',
  3: '0x55ab4c8a5f11f8e62d7822d5aed778784df12afd',
  4: '0x6995aa07b177918423d2127b885b67e7a3cec265'
};

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
  const web3ProviderArchival = GetArchiveWeb3Provider();
  const currentBlock = await web3ProviderArchival.getBlockNumber();
  const multicallArchivalProvider = MulticallWrapper.wrap(web3ProviderArchival);
  const startDate = new Date(2024, 3, 19, 12, 0, 0);
  const endDate = new Date(2024, 4, 17, 12, 0, 0);
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

  const fullData: UserDailyData = {};
  while (currentDate < endDate) {
    const stopDate = structuredClone(currentDate);
    stopDate.setDate(stopDate.getDate() + 1);
    const blockEnd = await getBlockAtTimestamp('arbitrum', Math.round(currentDate.getTime() / 1000));

    console.log(
      `[${currentDate.toISOString()} - ${stopDate.toISOString()}], block range: [${blockStart} - ${blockEnd}]`
    );

    const dateStr = stopDate.toISOString().split('T')[0];

    // init all addresses with 0 for all markets
    initAllUsersData(marketAddresses, fullData, fullConfig, dateStr);

    const blockToUse = blockEnd; // blockStart + Math.floor(Math.random() * (blockEnd - blockStart + 1));
    for (const marketId of Object.keys(fullConfig)) {
      if (Number(marketId) > 1e6) {
        continue;
      }

      const config = fullConfig[Number(marketId)] as ProtocolConstants;
      if (config.deployBlock > blockToUse) {
        continue; // ignore market if deployed later
      }

      // fetch all loans
      const loansFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'loans.json');

      const loansFile: LoansFileStructure = ReadJSON(loansFilename);

      const uniqueAddresses = marketAddresses[Number(marketId)];

      const creditToken = ERC20__factory.connect(config.creditTokenAddress, multicallArchivalProvider);
      const balanceOfResults = await Promise.all(
        uniqueAddresses.map((_) => creditToken.balanceOf(_, { blockTag: blockToUse }))
      );

      const guildContract = GuildToken__factory.connect(config.guildTokenAddress, multicallArchivalProvider);
      const liveTerms = await GetGaugeForMarketId(guildContract, Number(marketId), true, blockToUse);

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

      const allLoansValue = await Promise.all(
        loansFile.loans.map((_) => {
          const lendingTermContract = LendingTerm__factory.connect(_.lendingTermAddress, multicallArchivalProvider);
          return lendingTermContract.getLoanDebt(_.id, { blockTag: blockToUse });
        })
      );

      const blockTimestamp = Math.round(stopDate.getTime() / 1000);
      const pegTokenValue = await GetTokenPriceAtTimestamp(config.pegTokenAddress, blockTimestamp);

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
        for (let cursorLoan = 0; cursorLoan < loansFile.loans.length; cursorLoan++) {
          const loan = loansFile.loans[cursorLoan];
          if (loan.borrowerAddress == address) {
            totalUserBorrowValueCredit += norm(allLoansValue[cursorLoan]);
          }
        }

        if (!fullData[address]) {
          fullData[address] = {
            userAddress: address,
            dailyBalances: {}
          };
        }

        if (!fullData[address].dailyBalances[dateStr]) {
          fullData[address].dailyBalances[dateStr] = {};
        }

        fullData[address].dailyBalances[dateStr][`market_${marketId}`] = {
          creditBalanceUsd: userCreditBalance * pegTokenValue,
          stakedBalanceUsd: totalUserStakeCredit * pegTokenValue,
          borrowBalanceUsd: totalUserBorrowValueCredit * pegTokenValue
        };
      }

      WriteJSON('aidrop-data.json', fullData);
    }

    WriteJSON('aidrop-data.json', fullData);
    blockStart = blockEnd + 1;
    currentDate = stopDate;
  }
  WriteJSON('aidrop-data.json', fullData);
}

// Define the interface for the API response
interface BlockResponse {
  height: number;
  timestamp: number;
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

async function airdropDataToCsv() {
  const fullData = ReadJSON('aidrop-data.json') as UserDailyData;

  const averages: { [userAddress: string]: { averageCredit: number; averageStaked: number; averageBorrowed: number } } =
    {};

  for (const userAddress in fullData) {
    let totalCredit = 0;
    let totalStaked = 0;
    let totalBorrowed = 0;
    let countDays = 0;

    for (const date in fullData[userAddress].dailyBalances) {
      for (const market in fullData[userAddress].dailyBalances[date]) {
        totalCredit += fullData[userAddress].dailyBalances[date][market].creditBalanceUsd;
        totalStaked += fullData[userAddress].dailyBalances[date][market].stakedBalanceUsd;
        totalBorrowed += fullData[userAddress].dailyBalances[date][market].borrowBalanceUsd;
      }
      countDays++;
    }

    averages[userAddress] = {
      averageCredit: totalCredit / countDays,
      averageStaked: totalStaked / countDays,
      averageBorrowed: totalBorrowed / countDays
    };
  }

  console.log(averages);
  const csv: string[] = [];
  csv.push('User Address,Average Credit,Average Staked,Average Borrowed');

  for (const userAddress in averages) {
    const userAverages = averages[userAddress];
    const csvLine = `${userAddress},${userAverages.averageCredit},${userAverages.averageStaked},${userAverages.averageBorrowed}`;
    csv.push(csvLine);
  }

  writeFileSync('airdrop.csv', csv.join('\n'));
}

// Function to get the block at a specific timestamp
async function getBlockAtTimestamp(chain: string, timestamp: number): Promise<number> {
  const response = await HttpGet<BlockResponse>(`https://coins.llama.fi/block/${chain}/${timestamp}`);
  return response.height;
}

computeAirdropData();
// airdropDataToCsv();
