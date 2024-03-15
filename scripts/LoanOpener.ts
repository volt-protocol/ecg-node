import { GetWeb3Provider } from '../src/utils/Web3Helper';
import { GuildToken__factory } from '../src/contracts/types/factories/GuildToken__factory';
import { LendingTermOnboarding__factory } from '../src/contracts/types/factories/LendingTermOnboarding__factory';
import { LendingTermFactory__factory } from '../src/contracts/types/factories/LendingTermFactory__factory';
import { LendingTerm__factory } from '../src/contracts/types/factories/LendingTerm__factory';
import { ERC20__factory } from '../src/contracts/types/factories/ERC20__factory';
import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import { sleep } from '../src/utils/Utils';
dotenv.config();
/**
 * everytime this script is launched, it will open a new loan
 */

const LENDING_TERM = '0x427425372b643fc082328b70A0466302179260f5'; // this is the lending term that will be onboarded/offboarded
const web3Provider = GetWeb3Provider();
const privateKey = process.env.LOAN_OPENER_PRIVATE_KEY;
const _1e18 = 10n ** 18n;
async function LoanOpener() {
  console.log('LoanOpener: starting');
  const signer = new ethers.Wallet(privateKey!, web3Provider);
  const lendingTerm = LendingTerm__factory.connect(LENDING_TERM, signer);

  // const ERC20_SDAI = ERC20__factory.connect('0x9f07498d9f4903b10db57a3bd1d91b6b64aed61e', signer);
  // await (await ERC20_SDAI.approve(LENDING_TERM, 1_000_000_000n * _1e18)).wait();
  const borrowTx = await lendingTerm.borrow(500n * _1e18, 1000n * _1e18);
  let txFinished = false;
  while (!txFinished) {
    const txReceipt = await web3Provider.getTransactionReceipt(borrowTx.hash);
    if (txReceipt && txReceipt.blockNumber) {
      console.log(`transaction has been mined in block ${txReceipt.blockNumber}`);
      txFinished = true;
    } else {
      console.log(`waiting for transaction ${borrowTx.hash} to be mined`);
      await sleep(5000);
    }
  }
}

LoanOpener();

// async function createTerm() {
//   // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
//   const signer = new ethers.Wallet(privateKey!, web3Provider);

//   const ON_BOARDING_CONTRACT = '0x3274ebe53c4fa1d0a59ad8fadbc6f944186b408e';
//   const lendingTermFactory = LendingTermFactory__factory.connect('0xd3ecFC72fE299B58764E12AC38d59f20fc287052', signer);
//   const lendingTermV1 = '0x87b22b22666c15c11b8632c8a132ee820b783061';
//   const auctionHouse = '0x912e76518b318c209ef7ff04d119967acae3569e';
//   await (
//     await lendingTermFactory.createTerm(1, lendingTermV1, auctionHouse, {
//       collateralToken: '0x9f07498d9f4903b10db57a3bd1d91b6b64aed61e', // SDAI
//       maxDebtPerCollateralToken: 10n ** 18n,
//       interestRate: 10n ** 17n, // 10%
//       maxDelayBetweenPartialRepay: 1, // 1 sec
//       minPartialRepayPercent: 1n ** 16n, // 1%
//       openingFee: 0,
//       hardCap: 2_000_000n * 10n ** 18n
//     })
//   ).wait();
//   // const onboarding = LendingTermOnboarding__factory.connect(ON_BOARDING_CONTRACT, web3Provider);
//   // onboarding.proposeOnboard(LENDING_TERM)
// }
// createTerm();
