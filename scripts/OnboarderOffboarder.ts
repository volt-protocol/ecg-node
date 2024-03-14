import { GetWeb3Provider } from '../src/utils/Web3Helper';
import { GuildToken__factory } from '../src/contracts/types/factories/GuildToken__factory';

/**
 * 1/ propose a lending term with whatever parameters
 * 2/ onboard / vote for it / wait for it to be validated (the bot would have enough GUILD to do so)
 * 3/ start a borrow (or multiple ?)
 * 4/ wait x hours and offboard the term
 * 5/ wait for liquidators to call / bid on the loan(s)
 * 6/ repeat every day?
 */

const LENDING_TERM = '0x1A4b58B68554FDdE58566cbC5803e63539457948'; // this is the lending term that will be onboarded/offboarded
const OFF_BOARDING_CONTRACT = '0xB2AED7B9dcE6826D510a2559Da83afD5a2aF9405';
const ON_BOARDING_CONTRACT = '0x3274ebe53c4fa1d0a59ad8fadbc6f944186b408e';
const GUILD_CONTRACT = '0x79E2B8553Da5361d90Ed08A9E3F2f3e5E5fF2f8f';
async function OnBoarderOffboarder() {
  console.log('OnBoarderOffboarder: starting');
  // check if the
  const web3Provider = GetWeb3Provider();
  const guildContract = GuildToken__factory.connect(GUILD_CONTRACT, web3Provider);
  // check if term is in live gauge
  const liveGauges = await guildContract.liveGauges();
  if (liveGauges.some((_) => LENDING_TERM.toLowerCase() == _.toLowerCase())) {
    console.log('OnBoarderOffboarder: term is live, will offboard');
  } else {
    console.log('OnBoarderOffboarder: term is not live, will onboard');
  }
}

OnBoarderOffboarder();
