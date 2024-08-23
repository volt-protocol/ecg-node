export interface TxBuilderModel {
  version: string;
  chainId: string;
  createdAt: number;
  meta: Meta;
  transactions: Transaction[];
}

export interface Meta {
  name: string;
  description: string;
  txBuilderVersion: string;
  createdFromSafeAddress: string;
  createdFromOwnerAddress: string;
  checksum: string;
}

export interface Transaction {
  to: string;
  value: string;
  data: null;
  contractMethod: ContractMethod;
  contractInputsValues: ContractInputsValues;
}

export interface ContractInputsValues {
  to: string;
  amount: string;
}

export interface ContractMethod {
  inputs: Input[];
  name: string;
  payable: boolean;
}

export interface Input {
  internalType: string;
  name: string;
  type: string;
}
