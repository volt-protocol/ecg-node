import { ethers } from 'ethers';
import { LendingTermFactory__factory } from '../src/contracts/types/factories/LendingTermFactory__factory';
import { GetWeb3Provider } from '../src/utils/Web3Helper';

const web3Provider = GetWeb3Provider();
const privateKey = process.env.LOAN_OPENER_PRIVATE_KEY;

async function createTerm() {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const signer = new ethers.Wallet(privateKey!, web3Provider);
  const lendingTermFactory = LendingTermFactory__factory.connect('0xd3ecFC72fE299B58764E12AC38d59f20fc287052', signer);
  const lendingTermV1 = '0x87b22b22666c15c11b8632c8a132ee820b783061';
  const auctionHouse = '0x912e76518b318c209ef7ff04d119967acae3569e';
  await (
    await lendingTermFactory.createTerm(1, lendingTermV1, auctionHouse, {
      collateralToken: '0x9f07498d9f4903b10db57a3bd1d91b6b64aed61e', // SDAI
      maxDebtPerCollateralToken: 10n ** 18n,
      interestRate: 10n ** 17n, // 10%
      maxDelayBetweenPartialRepay: 1, // 1 sec
      minPartialRepayPercent: 1n ** 16n, // 1%
      openingFee: 0,
      hardCap: 2_000_000n * 10n ** 18n
    })
  ).wait();
}
createTerm();
