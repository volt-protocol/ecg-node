import { MulticallWrapper } from 'ethers-multicall-provider';
import { GatewayV12__factory } from '../contracts/types';
import { GetWeb3Provider } from '../utils/Web3Helper';
import { GetFullConfigFile } from '../config/Config';
import { HttpGet } from '../utils/HttpHelper';

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
  const gatewayWithACL = GatewayV12__factory.connect(gatewayAddress, provider);

  const fullyAllowedResults = await Promise.all(
    addressesThatShouldFullyBeAllowed.map((_) => gatewayWithACL.allowedAddresses(_))
  );

  const errors: string[] = [];

  for (let i = 0; i < addressesThatShouldFullyBeAllowed.length; i++) {
    const a = addressesThatShouldFullyBeAllowed[i];
    const result = fullyAllowedResults[i];

    if (!result) {
      errors.push(`Address ${a} should be fulled allowed and is not`);
    }
  }
  const addressesThatShouldAllowApprove: string[] = await getApproveAllowedAddresses();
  const approveSig = '0x095ea7b3';
  const onlyApproveAllowedResults = await Promise.all(
    addressesThatShouldAllowApprove.map((_) => gatewayWithACL.allowedCalls(_, approveSig))
  );

  for (let i = 0; i < addressesThatShouldAllowApprove.length; i++) {
    const a = addressesThatShouldFullyBeAllowed[i];
    const result = onlyApproveAllowedResults[i];

    if (!result) {
      errors.push(`Address ${a} have "approve" allowed and is not`);
    }
  }

  console.log(errors.join('\n'));
}

async function getFullyAllowedAddresses(): Promise<string[]> {
  const addresses: string[] = [];
  addresses.push(...routers);
  // should be all PSMs, all routers, all auction houses, all credit tokens
  const fullConfig = await GetFullConfigFile();
  for (const marketId of Object.keys(fullConfig)) {
    const config = fullConfig[Number(marketId)];
    addresses.push(config.psmAddress);
    addresses.push(config.creditTokenAddress);
  }

  return addresses;
}

function getApproveAllowedAddresses(): string[] | PromiseLike<string[]> {
  throw new Error('Function not implemented.');
}

TestGatewayACLs();
