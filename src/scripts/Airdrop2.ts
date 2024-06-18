import { ethers } from 'ethers';
import { MulticallWrapper, MulticallProvider } from 'ethers-multicall-provider';
import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import { GetFullConfigFile, ConfigFile, LoadTokens } from '../config/Config';
import { ERC20__factory, GuildToken, GuildToken__factory, LendingTerm__factory } from '../contracts/types';
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
import { totalmem } from 'os';

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

const GUILD_ADDRESS = '0xb8ae64F191F829fC00A4E923D460a8F2E0ba3978';

const marketSgm: { [marketId: number]: string } = {
  1: '0xB94AaAe7472a694Dd959C8497b2f09730391dc52',
  3: '0x55aB4C8a5f11f8E62d7822d5AEd778784DF12aFD',
  4: '0x6995aA07B177918423d2127B885b67E7A3ceC265'
};

interface AirdropData {
  marketUtilizationUsd: { [dayIso: string]: { [marketId: number]: number } };
  termsData: { [dayIso: string]: { [marketId: number]: { [termAddress: string]: TermDailyData } } };
  userData: UserDailyData;
}

interface TermDailyData {
  termAddress: string;
  issuanceCredit: number;
  interestRate: number;
  issuanceUsd: number;
  interest24hUsd: number;
  userStakes: { [userAddress: string]: number };
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
  borrowBalanceUsd: number;
}

async function computeAirdropData() {
  const fullConfig = await GetFullConfigFile();
  await LoadTokens();
  const web3ProviderArchival = GetArchiveWeb3Provider();
  const currentBlock = await web3ProviderArchival.getBlockNumber();
  const multicallArchivalProvider = MulticallWrapper.wrap(web3ProviderArchival, 0);
  const startDate = new Date(2024, 4, 16, 8, 57, 0);
  const endDate = new Date(2024, 5, 14, 8, 57, 0);
  let currentDate = startDate;
  let blockStart = await getBlockAtTimestamp('arbitrum', Math.round(currentDate.getTime() / 1000));
  const marketAddresses: { [marketId: number]: string[] } = {};

  const guildHolders = await getAllGuildHolders(fullConfig[1], web3ProviderArchival, 197467648, currentBlock);
  console.log(`Guild holders: ${guildHolders.length}`);

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
    userData: {},
    termsData: {}
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

      if (!fullData.marketUtilizationUsd[dateStr]) {
        fullData.marketUtilizationUsd[dateStr] = {};
      }

      fullData.marketUtilizationUsd[dateStr][Number(marketId)] = 0;

      if (!fullData.termsData[dateStr]) {
        fullData.termsData[dateStr] = {};
      }

      fullData.termsData[dateStr][Number(marketId)] = {};

      // fetch all loans
      const loansFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'loans.json');

      const loansFile: LoansFileStructure = ReadJSON(loansFilename);

      const creditHolders = marketAddresses[Number(marketId)];

      const creditToken = ERC20__factory.connect(config.creditTokenAddress, multicallArchivalProvider);
      console.log('Getting balance of results');
      const balanceOfResults = await retry(
        () => Promise.all(creditHolders.map((_) => creditToken.balanceOf(_, { blockTag: blockToUse }))),
        []
      );

      const guildContract = GuildToken__factory.connect(config.guildTokenAddress, multicallArchivalProvider);
      console.log('Getting live terms with debt ceiling');
      const allLiveTerms = await retry(
        () => GetGaugeForMarketId(guildContract, Number(marketId), true, blockToUse),
        []
      );

      const liveTerms: string[] = await getAllTermsWithDebtCeiling(
        allLiveTerms,
        guildContract,
        marketId,
        blockToUse,
        multicallArchivalProvider
      );

      console.log('Getting user stake results');
      const userStakeResults = await retry(getUserStakeResult, [
        marketId,
        multicallArchivalProvider,
        creditHolders,
        liveTerms,
        blockToUse
      ]);

      console.log('Getting user guild results');
      const guildStakeResults = await retry(getGuildStakeResult, [
        multicallArchivalProvider,
        guildHolders,
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

      const termIssuancePromises = liveTerms.map(async (_) => {
        const lendingTermContract = LendingTerm__factory.connect(_, multicallArchivalProvider);
        const issuance = await lendingTermContract.issuance({ blockTag: blockToUse });
        const params = await lendingTermContract.getParameters({ blockTag: blockToUse });
        return { issuanceCredit: norm(issuance), interestRate: norm(params.interestRate) };
      });

      const termIssuanceResults = await Promise.all(termIssuancePromises);

      let termCursor = 0;
      const termIssuanceAndInterestRate: { [termAddress: string]: { issuanceCredit: number; interestRate: number } } =
        {};
      for (const term of liveTerms) {
        termIssuanceAndInterestRate[term] = termIssuanceResults[termCursor++];
      }

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
      for (const creditHolder of creditHolders) {
        if (allLiveTerms.includes(creditHolder)) {
          continue; // ignore terms in the credit holder list
        }
        const addressBalancePegToken = balanceOfResults[cursorBalanceOf++];
        let userCreditBalance = 0;

        if (addressBalancePegToken != 0n) {
          userCreditBalance = norm(addressBalancePegToken);
        }

        let totalUserStakeGuild = 0;
        if (userStakeResults[creditHolder]) {
          totalUserStakeGuild += userStakeResults[creditHolder].total;
        }

        if (guildStakeResults[creditHolder]) {
          totalUserStakeGuild += guildStakeResults[creditHolder].total;
        }

        let totalUserBorrowValueCredit = 0;
        const userLoans = allLoansValue.filter((_) => _.borrower == creditHolder);
        for (const loan of userLoans) {
          totalUserBorrowValueCredit += norm(loan.debt);
        }

        if (!fullData.userData[creditHolder]) {
          fullData.userData[creditHolder] = {
            userAddress: creditHolder,
            dailyBalances: {}
          };
        }

        if (!fullData.userData[creditHolder].dailyBalances[dateStr]) {
          fullData.userData[creditHolder].dailyBalances[dateStr] = {};
        }

        fullData.userData[creditHolder].dailyBalances[dateStr][`market_${marketId}`] = {
          creditBalanceUsd: userCreditBalance * pegTokenValue,
          borrowBalanceUsd: totalUserBorrowValueCredit * pegTokenValue
        };

        fullData.marketUtilizationUsd[dateStr][Number(marketId)] +=
          fullData.userData[creditHolder].dailyBalances[dateStr][`market_${marketId}`].borrowBalanceUsd;
      }

      // for (const guildHolder of guildHolders) {
      //   if (!creditHolders.includes(guildHolder)) {
      //     // guild holder never held any credit, so we should add only his guild stakes
      //     if (guildStakeResults[guildHolder].total == 0) {
      //       continue;
      //     }

      //     if (!fullData.userData[guildHolder]) {
      //       fullData.userData[guildHolder] = {
      //         userAddress: guildHolder,
      //         dailyBalances: {}
      //       };
      //     }

      //     if (!fullData.userData[guildHolder].dailyBalances[dateStr]) {
      //       fullData.userData[guildHolder].dailyBalances[dateStr] = {};
      //     }

      //     fullData.userData[guildHolder].dailyBalances[dateStr][`market_${marketId}`] = {
      //       creditBalanceUsd: 0,
      //       borrowBalanceUsd: 0
      //     };
      //   }
      // }

      for (const term of liveTerms) {
        const termData = termIssuanceAndInterestRate[term];
        if (termData.issuanceCredit == 0) {
          continue;
        }

        fullData.termsData[dateStr][Number(marketId)][term] = {
          interestRate: termData.interestRate,
          issuanceCredit: termData.issuanceCredit,
          issuanceUsd: termData.issuanceCredit * pegTokenValue,
          termAddress: term,
          interest24hUsd: (termData.issuanceCredit * pegTokenValue * termData.interestRate) / 365.25,
          userStakes: {}
        };

        // find userStake for that term
        for (const creditHolder of creditHolders) {
          if (userStakeResults[creditHolder] && userStakeResults[creditHolder].terms[term]) {
            fullData.termsData[dateStr][Number(marketId)][term].userStakes[creditHolder] =
              userStakeResults[creditHolder].terms[term];
          }
        }

        for (const guildHolder of guildHolders) {
          if (guildStakeResults[guildHolder] && guildStakeResults[guildHolder].terms[term]) {
            fullData.termsData[dateStr][Number(marketId)][term].userStakes[guildHolder] =
              guildStakeResults[guildHolder].terms[term];
          }
        }
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

async function getAllTermsWithDebtCeiling(
  allLiveTerms: string[],
  guildContract: GuildToken,
  marketId: string,
  blockToUse: number,
  multicallArchivalProvider: MulticallProvider<ethers.JsonRpcProvider>
) {
  // liveTerms are only the terms with > 0 debt ceiling
  const liveTermsPromises = allLiveTerms.map((_) => {
    const termContract = LendingTerm__factory.connect(_, multicallArchivalProvider);
    return termContract['debtCeiling()']({ blockTag: blockToUse });
  });

  const liveTermsDebtCeilings = await Promise.all(liveTermsPromises);

  const liveTerms: string[] = [];
  for (let i = 0; i < allLiveTerms.length; i++) {
    const termAddress = allLiveTerms[i];
    const debtCeiling = liveTermsDebtCeilings[i];
    if (debtCeiling > 0n) {
      liveTerms.push(termAddress);
    }
  }
  return liveTerms;
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
  const results: { [userAddress: string]: { total: number; terms: { [termAddress: string]: number } } } = {};
  let cursor = 0;
  for (const userAddress of uniqueAddresses) {
    if (!results[userAddress]) {
      results[userAddress] = {
        total: 0,
        terms: {}
      };
    }
    for (const termAddress of liveTerms) {
      const guildStaked = userStakeResults[cursor++].guild;

      results[userAddress].total += norm(guildStaked, 18);
      results[userAddress].terms[termAddress] = norm(guildStaked, 18);
    }
  }

  return results;
}

async function getGuildStakeResult(
  multicallArchivalProvider: MulticallProvider<ethers.JsonRpcProvider>,
  guildHolders: string[],
  liveTerms: string[],
  blockToUse: number
) {
  const guildTokenContract = GuildToken__factory.connect(GUILD_ADDRESS, multicallArchivalProvider);

  const userGuildStakePromises: Promise<bigint>[] = [];

  for (const userAddress of guildHolders) {
    for (const termAddress of liveTerms) {
      userGuildStakePromises.push(
        guildTokenContract.getUserGaugeWeight(userAddress, termAddress, { blockTag: blockToUse })
      );
    }
  }

  const guildStakesResults = await Promise.all(userGuildStakePromises);

  const results: { [userAddress: string]: { total: number; terms: { [termAddress: string]: number } } } = {};
  let cursor = 0;
  for (const userAddress of guildHolders) {
    if (!results[userAddress]) {
      results[userAddress] = {
        total: 0,
        terms: {}
      };
    }
    for (const termAddress of liveTerms) {
      const guildStaked = guildStakesResults[cursor++];

      results[userAddress].total += norm(guildStaked, 18);
      results[userAddress].terms[termAddress] = norm(guildStaked, 18);
    }
  }

  return results;
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
  return Array.from(
    new Set<string>(creditTransfers.filter((_) => _.args.to != ethers.ZeroAddress).map((_) => _.args.to))
  );
}

async function getAllGuildHolders(
  config: ProtocolConstants,
  web3Provider: ethers.JsonRpcProvider,
  startBlock: number,
  endBlock: number
) {
  const guildTokenContract = GuildToken__factory.connect(config.guildTokenAddress, web3Provider);
  const guildTransfers = await FetchAllEvents(guildTokenContract, 'guild token', 'Transfer', startBlock, endBlock);
  return Array.from(
    new Set<string>(guildTransfers.filter((_) => _.args.to != ethers.ZeroAddress).map((_) => _.args.to))
  );
}

// Function to get the block at a specific timestamp
async function getBlockAtTimestamp(chain: string, timestamp: number): Promise<number> {
  const response = await HttpGet<BlockResponse>(`https://coins.llama.fi/block/${chain}/${timestamp}`);
  return response.height;
}

computeAirdropData();
// airdropDataToCsv();
