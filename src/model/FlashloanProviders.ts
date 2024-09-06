export interface FlashloanProvider {
  type: FlashloanProviderEnum;
  flashloanContractAddress: string;
  fee: number;
}

export enum FlashloanProviderEnum {
  BALANCER = 'BALANCER',
  AAVE = 'AAVE'
}

export const FLASHLOAN_PROVIDERS: Record<FlashloanProviderEnum, FlashloanProvider> = {
  [FlashloanProviderEnum.BALANCER]: {
    type: FlashloanProviderEnum.BALANCER,
    flashloanContractAddress: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    fee: 0
  },
  [FlashloanProviderEnum.AAVE]: {
    type: FlashloanProviderEnum.AAVE,
    flashloanContractAddress: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    fee: 5 / 10000
  }
};
