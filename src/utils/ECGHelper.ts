// all helpers function related to the ECG

import { GetGuildTokenAddress } from '../config/Config';
import { GuildToken, GuildToken__factory } from '../contracts/types';
import { GetWeb3Provider } from './Web3Helper';

export async function GetGaugeForMarketId(
  guildContract: GuildToken,
  marketId: number,
  onlyLiveGauges: boolean,
  atBlock?: number
) {
  const terms = onlyLiveGauges
    ? await guildContract.liveGauges({ blockTag: atBlock })
    : await guildContract.gauges({ blockTag: atBlock });

  const gaugeTypesPromises: Promise<bigint>[] = [];
  for (const termAddress of terms) {
    gaugeTypesPromises.push(guildContract.gaugeType(termAddress, { blockTag: atBlock }));
  }

  const gaugeTypesResults = await Promise.all(gaugeTypesPromises);

  const gaugeForMarketId = [];
  let cursor = 0;
  for (const termAddress of terms) {
    const termMarketId = gaugeTypesResults[cursor++];
    if (Number(termMarketId) == marketId) {
      gaugeForMarketId.push(termAddress);
    }
  }

  return gaugeForMarketId;
}

export async function GetTermMarketId(termAddress: string) {
  const guildContract = GuildToken__factory.connect(await GetGuildTokenAddress(), GetWeb3Provider());
  const gaugeType = await guildContract.gaugeType(termAddress);
  return Number(gaugeType);
}
