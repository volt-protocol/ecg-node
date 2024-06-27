import { GatewayV12__factory } from '../contracts/types';
import { GetWeb3Provider } from '../utils/Web3Helper';

const gatewayAddress = '';
async function TestGatewayACLs() {
  const provider = GetWeb3Provider(600_000);
  const addressesThatShouldFullyBeAllowed: string[] = await getFullyAllowedAddresses();
  const addressesThatShouldAllowApprove: string[] = await getApproveAllowedAddresses();
  const gatewayWithACL = GatewayV12__factory.connect(gatewayAddress, provider);
}

function getFullyAllowedAddresses(): string[] | PromiseLike<string[]> {
  throw new Error('Function not implemented.');
}

function getApproveAllowedAddresses(): string[] | PromiseLike<string[]> {
  throw new Error('Function not implemented.');
}

TestGatewayACLs();
