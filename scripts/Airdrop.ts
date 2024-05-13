import { GetFullConfigFile } from '../src/config/Config';
import { GetArchiveWeb3Provider, GetWeb3Provider } from '../src/utils/Web3Helper';
import { GuildToken__factory } from '../src/contracts/types/factories/GuildToken__factory';
import { LendingTermOnboarding__factory } from '../src/contracts/types/factories/LendingTermOnboarding__factory';
import { LendingTermFactory__factory } from '../src/contracts/types/factories/LendingTermFactory__factory';
import { LendingTerm__factory } from '../src/contracts/types/factories/LendingTerm__factory';
import { ERC20__factory } from '../src/contracts/types/factories/ERC20__factory';
import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import { ReadJSON, WriteJSON, sleep } from '../src/utils/Utils';
import { HttpGet } from '../src/utils/HttpHelper';
import { GLOBAL_DATA_DIR } from '../src/utils/Constants';
import { CreditTransferFile } from '../src/model/CreditTransfer';
import path from 'path';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { GetTokenPriceAtTimestamp } from '../src/utils/Price';
import { norm } from '../src/utils/TokenUtils';
import { ProtocolConstants } from '../src/model/ProtocolConstants';
import { GetGaugeForMarketId } from '../src/utils/ECGHelper';

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

interface DailyData {
  marketBalances: MarketBalance[];
}
interface MarketBalance {
  marketId: number;
  userBalances: UserBalance[];
}

interface UserBalance {
  address: string;
  creditBalanceUsd: number;
  stakedBalanceUsd: number;
  borrowBalanceUsd: number;
}

async function computeAirdropData() {
  const fullConfig = await GetFullConfigFile();
  const web3ProviderArchival = GetArchiveWeb3Provider();
  const multicallArchivalProvider = MulticallWrapper.wrap(web3ProviderArchival);
  const startDate = new Date(2024, 3, 19, 12, 0, 0);
  const endDate = new Date(2024, 4, 17, 12, 0, 0);
  let currentDate = startDate;
  let blockStart = await getBlockAtTimestamp('arbitrum', Math.round(currentDate.getTime() / 1000));
  const fullData: { [day: string]: DailyData } = {};
  while (currentDate < endDate) {
    const stopDate = structuredClone(currentDate);
    stopDate.setDate(stopDate.getDate() + 1);
    const blockEnd = await getBlockAtTimestamp('arbitrum', Math.round(currentDate.getTime() / 1000));

    console.log(
      `[${currentDate.toISOString()} - ${stopDate.toISOString()}], block range: [${blockStart} - ${blockEnd}]`
    );

    const blockToUse = blockEnd; // blockStart + Math.floor(Math.random() * (blockEnd - blockStart + 1));
    for (const marketId of Object.keys(fullConfig)) {
      if (Number(marketId) > 1e6) {
        continue;
      }

      const config = fullConfig[Number(marketId)] as ProtocolConstants;
      if (config.deployBlock > blockToUse) {
        continue; // ignore market if deployed later
      }
      const marketBalances: MarketBalance = {
        marketId: Number(marketId),
        userBalances: []
      };
      // fetch all addresses who ever held credit
      const creditTransfersFilename = path.join(
        GLOBAL_DATA_DIR,
        `market_${marketId}`,
        'history',
        'credit-transfers.json'
      );

      const creditTransferFile: CreditTransferFile = ReadJSON(creditTransfersFilename);

      const uniqueAddresses = Array.from(
        new Set<string>(
          creditTransferFile.transfers.filter((_) => _.address != ethers.ZeroAddress).map((_) => _.args.to)
        )
      );
      const creditToken = ERC20__factory.connect(config.creditTokenAddress, multicallArchivalProvider);
      const balanceOfResults = await Promise.all(
        uniqueAddresses.map((_) => creditToken.balanceOf(_, { blockTag: blockToUse }))
      );

      const guildContract = GuildToken__factory.connect(config.guildTokenAddress, multicallArchivalProvider);
      const liveTerms = await GetGaugeForMarketId(guildContract, Number(marketId), true, blockToUse);

      const blockTimestamp = Math.round(stopDate.getTime() / 1000);
      const pegTokenValue = await GetTokenPriceAtTimestamp(config.pegTokenAddress, blockTimestamp);

      if (!pegTokenValue) {
        throw new Error(`Cannot find peg token price at timestamp ${blockTimestamp}`);
      }

      let cursor = 0;
      for (const address of uniqueAddresses) {
        const addressBalancePegToken = balanceOfResults[cursor++];
        if (addressBalancePegToken == 0n) {
          continue;
        }
        const normalizedBalancePegToken = norm(addressBalancePegToken);
        const balanceInUsd = normalizedBalancePegToken * pegTokenValue;
        marketBalances.userBalances.push({
          address,
          creditBalanceUsd: balanceInUsd,
          stakedBalanceUsd: 0,
          borrowBalanceUsd: 0
        });
      }

      if (!fullData[stopDate.toISOString()]) {
        fullData[stopDate.toISOString()] = { marketBalances: [] };
      }

      fullData[stopDate.toISOString()].marketBalances.push(marketBalances);
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

// Function to get the block at a specific timestamp
async function getBlockAtTimestamp(chain: string, timestamp: number): Promise<number> {
  const response = await HttpGet<BlockResponse>(`https://coins.llama.fi/block/${chain}/${timestamp}`);
  return response.height;
}

computeAirdropData();
