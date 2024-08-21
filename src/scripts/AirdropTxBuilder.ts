import { TxBuilderModel } from '../model/TxBuilderModel';
import { norm } from '../utils/TokenUtils';
import { ReadJSON, WriteJSON } from '../utils/Utils';

const PREGUILD_ADDRESS = '0xe38d06840c9E527b8D40309CCcF4B05af0F888A5';
const TOKEN_DECIMALS = 18; // TODO MAKE IT DYNAMIC ? OR PASS AS ARGUMENT ?
async function buildAirdropTx(amountAirdrop: string, airdropTokenAddress: string, weightFile: string) {
  const userWeights = ReadJSON(weightFile) as { [user: string]: string };
  const amountAirdropBn = BigInt(amountAirdrop);
  const totalWeight = Object.values(userWeights).reduce((acc, curr) => acc + BigInt(curr), 0n);
  const txBuilderJson = generateJsonTxBuilder(amountAirdropBn, airdropTokenAddress, userWeights, totalWeight);

  const sumOfAmounts = txBuilderJson.transactions.reduce(
    (acc, curr) => acc + BigInt(curr.contractInputsValues.amount),
    0n
  );

  // ensure sum of amounts is less than or equal to amountAirdrop
  if (sumOfAmounts > amountAirdropBn) {
    throw new Error('Cannot airdrop more than the total amount');
  }

  // ensure sum of amounts is min 90% of the total amount
  if (sumOfAmounts < (amountAirdropBn * 90n) / 100n) {
    throw new Error('Cannot airdrop less than 90% of the total amount');
  }

  console.log(JSON.stringify(txBuilderJson, null, 2));
  WriteJSON('txBuilder.json', txBuilderJson);
}

function generateJsonTxBuilder(
  amountAirdropBn: bigint,
  airdropTokenAddress: string,
  userWeights: { [user: string]: string },
  totalWeight: bigint
) {
  // if the airdrop token is the preguild token, we use the redeem function, otherwise we use the transfer function
  const contractFct = airdropTokenAddress == PREGUILD_ADDRESS ? 'redeem' : 'transfer';

  const txBuilderJson: TxBuilderModel = {
    version: '1.0',
    chainId: '42161',
    createdAt: Date.now(),
    meta: {
      name: 'Transactions Batch',
      description: '',
      txBuilderVersion: '1.16.5',
      createdFromSafeAddress: '0x1A1075cef632624153176CCf19Ae0175953CF010',
      createdFromOwnerAddress: '',
      checksum: '0x0'
    },
    transactions: []
  };

  for (const userAddress of Object.keys(userWeights)) {
    const userWeightBn = BigInt(userWeights[userAddress]);
    if (userWeightBn == 0n) {
      console.log('userWeightBn == 0n', userAddress);
      continue;
    }

    // amount to airdrop to user is equals to the ratio of the user weight over the total weight times amount to be airdropped
    const amountToAirdropToUser = (amountAirdropBn * userWeightBn) / totalWeight;
    if (amountToAirdropToUser < 100n * 10n ** BigInt(TOKEN_DECIMALS)) {
      console.log('amountToAirdropToUser < 100 tokens', userAddress, norm(amountToAirdropToUser));
      continue;
    }

    txBuilderJson.transactions.push({
      to: airdropTokenAddress,
      value: '0',
      data: null,
      contractMethod: {
        inputs: [
          {
            internalType: 'address',
            name: 'to',
            type: 'address'
          },
          {
            internalType: 'uint256',
            name: 'amount',
            type: 'uint256'
          }
        ],
        name: contractFct,
        payable: false
      },
      contractInputsValues: {
        to: userAddress,
        amount: amountToAirdropToUser.toString(10)
      }
    });
  }

  // sort the transactions by amount in descending order
  txBuilderJson.transactions.sort(
    (a, b) => Number(b.contractInputsValues.amount) - Number(a.contractInputsValues.amount)
  );
  return txBuilderJson;
}

buildAirdropTx(process.argv[2], process.argv[3], process.argv[4]);
