import { MARKET_ID, TOKENS_FILE, CONFIG_FILE, NETWORK, PENDLE_ORACLES } from '../utils/Constants';
import { readFileSync } from 'fs';
import { HttpGet } from '../utils/HttpHelper';
import SimpleCacheService from '../services/cache/CacheService';
import { ConfigFile, ProtocolConstants, TokenConfig } from '../model/Config';

export async function GetFullConfigFile(): Promise<ConfigFile> {
  const configFile = await SimpleCacheService.GetAndCache(
    'config-file',
    async () => {
      // Log(`LoadConfiguration: loading protocol data from ${CONFIG_FILE}`);
      if (CONFIG_FILE.startsWith('http')) {
        // load via http
        const resp = await HttpGet<ConfigFile>(CONFIG_FILE);
        return resp;
      } else {
        // read from filesystem
        return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      }
    },
    5 * 60 * 1000
  );

  return configFile;
}

async function GetProtocolConstants(): Promise<ProtocolConstants> {
  const configFile = await GetFullConfigFile();
  const configuration = configFile[MARKET_ID];

  if (!configuration) {
    throw new Error(`CANNOT FIND CONFIGURATION FOR MARKET_ID ${MARKET_ID} on file ${CONFIG_FILE}`);
  }

  return configuration;
}

export async function GetAllTokensFromConfiguration(): Promise<TokenConfig[]> {
  const tokens = await SimpleCacheService.GetAndCache(
    'config-tokens',
    async () => {
      // Log(`LoadConfiguration: loading tokens data from ${TOKENS_FILE}`);
      if (TOKENS_FILE.startsWith('http')) {
        // load via http
        const resp = await HttpGet<TokenConfig[]>(TOKENS_FILE);
        return resp;
      } else {
        // read from filesystem
        return JSON.parse(readFileSync(TOKENS_FILE, 'utf-8'));
      }
    },
    5 * 60 * 1000
  );

  if (!tokens || tokens.length == 0) {
    throw new Error(`CANNOT FIND TOKENS CONFIG on file ${TOKENS_FILE}`);
  }

  return tokens;
}
/**
 * Get a token by its symbol, throw if not found
 * @param symbol
 */
export async function getTokenBySymbol(symbol: string): Promise<TokenConfig> {
  const token = (await GetAllTokensFromConfiguration()).find((_) => _.symbol == symbol);
  if (!token) {
    throw new Error(`Could not find token with symbol: ${symbol}`);
  }

  return token;
}

/**
 * Get a token by its address, throw if not found
 * @param symbol
 */
export async function getTokenByAddress(address: string) {
  const token = (await GetAllTokensFromConfiguration()).find((_) => _.address == address);
  if (!token) {
    throw new Error(`Could not find token with address: ${address}`);
  }

  return token;
}

/**
 * Get a token by its address, return undefined if not found
 * @param symbol
 */
export async function getTokenByAddressNoError(address: string) {
  return (await GetAllTokensFromConfiguration()).find((_) => _.address == address);
}

export async function GetDeployBlock() {
  if (!(await GetProtocolConstants()).deployBlock || (await GetProtocolConstants()).deployBlock == 0) {
    throw new Error(`'deployBlock' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).deployBlock;
}

export async function GetHistoricalMinBlock() {
  if (!(await GetProtocolConstants()).historicalMinBlock || (await GetProtocolConstants()).historicalMinBlock == 0) {
    throw new Error(`'historicalMinBlock' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).historicalMinBlock;
}

export async function GetGuildTokenAddress() {
  if (!(await GetProtocolConstants()).guildTokenAddress) {
    throw new Error(`'guildTokenAddress' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).guildTokenAddress;
}

export async function GetPegTokenAddress() {
  if (!(await GetProtocolConstants()).pegTokenAddress) {
    throw new Error(`'pegTokenAddress' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).pegTokenAddress;
}

export async function GetCreditTokenAddress() {
  if (!(await GetProtocolConstants()).creditTokenAddress) {
    throw new Error(`'creditTokenAddress' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).creditTokenAddress;
}

export async function GetProfitManagerAddress() {
  if (!(await GetProtocolConstants()).profitManagerAddress) {
    throw new Error(`'profitManagerAddress' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).profitManagerAddress;
}

export async function GetLendingTermOffboardingAddress() {
  if (!(await GetProtocolConstants()).lendingTermOffboardingAddress) {
    throw new Error(`'lendingTermOffboardingAddress' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).lendingTermOffboardingAddress;
}

export async function GetLendingTermOnboardingAddress() {
  if (!(await GetProtocolConstants()).lendingTermOnboardingAddress) {
    throw new Error(`'lendingTermOnboardingAddress' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).lendingTermOnboardingAddress;
}

export async function GetUniswapV2RouterAddress() {
  if (!(await GetProtocolConstants()).uniswapV2RouterAddress) {
    throw new Error(`'uniswapV2RouterAddress' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).uniswapV2RouterAddress;
}

export async function GetGatewayAddress() {
  if (!(await GetProtocolConstants()).gatewayAddress) {
    throw new Error(`'gatewayAddress' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).gatewayAddress;
}

export async function GetPSMAddress() {
  if (!(await GetProtocolConstants()).psmAddress) {
    throw new Error(`'psmAddress' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).psmAddress;
}

export async function GetDaoGovernorGuildAddress() {
  if (!(await GetProtocolConstants()).daoGovernorGuildAddress) {
    throw new Error(`'daoGovernorGuildAddress' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).daoGovernorGuildAddress;
}

export async function GetDaoVetoGuildAddress() {
  if (!(await GetProtocolConstants()).daoVetoGuildAddress) {
    throw new Error(`'daoVetoGuildAddress' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).daoVetoGuildAddress;
}

export async function GetLendingTermFactoryAddress() {
  if (!(await GetProtocolConstants()).lendingTermFactoryAddress) {
    throw new Error(`'lendingTermFactoryAddress' not set in (await GetProtocolConstants()) ${CONFIG_FILE}`);
  }
  return (await GetProtocolConstants()).lendingTermFactoryAddress;
}

export function GetPendleOracleAddress() {
  const pendleOracle = PENDLE_ORACLES[NETWORK];
  if (!pendleOracle) {
    throw new Error(`Cannot find pendle oracle for network ${NETWORK}`);
  }
  return pendleOracle;
}
