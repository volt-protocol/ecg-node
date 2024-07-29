import { MulticallWrapper } from 'ethers-multicall-provider';
import { GetWeb3Provider } from '../utils/Web3Helper';
import { GetAllTokensFromConfiguration, GetFullConfigFile } from '../config/Config';
import { HttpGet } from '../utils/HttpHelper';
import path from 'path';
import { GLOBAL_DATA_DIR } from '../utils/Constants';
import { AuctionHousesFileStructure } from '../model/AuctionHouse';
import { ReadJSON } from '../utils/Utils';
import { LendingTermsFileStructure } from '../model/LendingTerm';
import { SendNotifications, SendNotificationsList } from '../utils/Notifications';
import { GatewayV12__factory } from '../contracts/types';

const routers = [
  '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', // uniswap
  '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', // kyber
  '0x111111125421cA6dc452d289314280a0f8842A65', // 1inch
  '0x6352a56caadC4F1E25CD6c75970Fa768A3304e64', // opneocean
  '0x888888888889758F76e7103c6CbF23ABbF58F946' // pendle
];

const configUrl =
  'https://raw.githubusercontent.com/volt-protocol/ethereum-credit-guild/main/protocol-configuration/addresses.arbitrum.json';

async function TestGatewayACLs() {
  const protocolAddresses: { addr: string; name: string }[] = await HttpGet(configUrl);
  const gatewayAddress = protocolAddresses.find((_) => _.name == 'GATEWAY')?.addr;
  if (!gatewayAddress) {
    throw new Error('Cannot find GATEWAY in protocol config');
  }
  const provider = MulticallWrapper.wrap(GetWeb3Provider(600_000));
  const addressesThatShouldFullyBeAllowed: string[] = await getFullyAllowedAddresses();
  console.log(`Checking ${addressesThatShouldFullyBeAllowed.length} addresses that should be fully allowed`);
  const gatewayWithACL = GatewayV12__factory.connect(gatewayAddress, provider);

  const fullyAllowedResults = await Promise.all(
    addressesThatShouldFullyBeAllowed.map((_) => gatewayWithACL.allowedAddresses(_))
  );

  const errors: string[] = [];

  for (let i = 0; i < addressesThatShouldFullyBeAllowed.length; i++) {
    const a = addressesThatShouldFullyBeAllowed[i];
    const result = fullyAllowedResults[i];

    if (!result) {
      errors.push(`Address ${a} should be fully allowed but is not`);
    }
  }

  if (errors.length == 0) {
    console.log('No addresses missing in gateway config');
  }
  const addressesThatShouldAllowApprove: string[] = await getApproveAllowedAddresses();
  // remove addresses already in addressesThatShouldFullyBeAllowed
  const addressesToCheck = addressesThatShouldAllowApprove.filter(
    (_) => !addressesThatShouldFullyBeAllowed.includes(_)
  );
  console.log(`Checking ${addressesToCheck.length} addresses that should have "approve" allowed`);

  const approveSig = '0x095ea7b3';
  const onlyApproveAllowedResults = await Promise.all(
    addressesToCheck.map((_) => gatewayWithACL.allowedCalls(_, approveSig))
  );

  for (let i = 0; i < addressesToCheck.length; i++) {
    const a = addressesToCheck[i];
    const result = onlyApproveAllowedResults[i];

    if (!result) {
      errors.push(`Address ${a} should have "approve(address,uint256)" (0x095ea7b3) allowed but does not`);
    }
  }

  if (errors.length == 0) {
    console.log('No addresses missing in "approve" gateway config');
    await SendNotifications(
      'Gateway Checker',
      'All required addresses/calls are allowed',
      `Checked ${addressesThatShouldFullyBeAllowed.length} fully allowed addresses and ${addressesToCheck.length} approve only allowed addresses`
    );
  } else {
    console.log(errors.join('\n'));
    await SendNotificationsList(
      'Gateway Checker',
      'Missing gateway allowed addresses / calls',
      errors.map((_, i) => {
        return {
          fieldName: `# ${i}`,
          fieldValue: _
        };
      })
    );
  }
}

async function getFullyAllowedAddresses(): Promise<string[]> {
  const addresses = new Set<string>(routers);

  // should be all PSMs, all routers, all auction houses, all credit tokens
  const fullConfig = await GetFullConfigFile();
  for (const marketId of Object.keys(fullConfig)) {
    // ignore test market
    if (Number(marketId) > 1e6) {
      continue;
    }
    const config = fullConfig[Number(marketId)];
    addresses.add(config.psmAddress);
    addresses.add(config.creditTokenAddress);

    // find all auction houses
    const auctionHouseFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'auction-houses.json');
    const auctionHouses: AuctionHousesFileStructure = ReadJSON(auctionHouseFilename);
    for (const a of auctionHouses.auctionHouses) {
      addresses.add(a.address);
    }
  }

  return Array.from(addresses);
}

async function getApproveAllowedAddresses(): Promise<string[]> {
  const addresses = new Set<string>();
  const fullConfig = await GetFullConfigFile();
  for (const marketId of Object.keys(fullConfig)) {
    // ignore test market
    if (Number(marketId) > 1e6) {
      continue;
    }
    const config = fullConfig[Number(marketId)];
    addresses.add(config.pegTokenAddress);

    // add all collateral tokens
    const lendingTermFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'terms.json');
    const lendingTermFile: LendingTermsFileStructure = ReadJSON(lendingTermFilename);
    for (const t of lendingTermFile.terms) {
      addresses.add(t.collateralAddress);
    }
  }

  return Array.from(addresses);
}

TestGatewayACLs();
