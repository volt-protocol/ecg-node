import fs from 'fs';
import path from 'path';
import { GLOBAL_DATA_DIR, NETWORK } from '../../utils/Constants';
import { ReadJSON } from '../../utils/Utils';
import { LendingTermsApiResponse } from '../model/LendingTermsResponse';
import { LendingTermsFileStructure } from '../../model/LendingTerm';
import { norm } from '../../utils/TokenUtils';
import { getAllTokens, getTokenByAddress } from '../../config/Config';
import { TokensApiInfo } from '../model/TokensResponse';
import { HttpGet } from '../../utils/HttpHelper';
import { DefiLlamaPriceResponse } from '../../model/DefiLlama';
import { AuctionsApiReponse } from '../model/AuctionsApiReponse';
import { AuctionsFileStructure } from '../../model/Auction';
import { AuctionHousesFileStructure } from '../../model/AuctionHouse';
import { LastActivityFileStructure } from '../../model/LastActivity';
import { LastActivityApiResponse } from '../model/LastActivityApiResponse';
import { LoanStatus, LoansFileStructure } from '../../model/Loan';
import { LoansApiResponse } from '../model/LoansApiResponse';

class MarketDataController {
  static async GetTermsInfo(marketId: number): Promise<LendingTermsApiResponse> {
    const termsFileName = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'terms.json');
    const loansFileName = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'loans.json');
    if (!fs.existsSync(termsFileName)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    }

    if (!fs.existsSync(loansFileName)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    }

    const termsFile: LendingTermsFileStructure = ReadJSON(termsFileName);
    const loansFile: LoansFileStructure = ReadJSON(loansFileName);

    const response: LendingTermsApiResponse = {
      updateBlock: termsFile.updateBlock,
      updated: termsFile.updated,
      updatedHuman: termsFile.updatedHuman,
      terms: []
    };

    for (const term of termsFile.terms) {
      const collateralToken = getTokenByAddress(term.collateralAddress);
      const loansForTerm = loansFile.loans.filter((_) => _.lendingTermAddress == term.termAddress);
      response.terms.push({
        address: term.termAddress,
        availableDebt: norm(term.availableDebt),
        borrowRatio: norm(term.maxDebtPerCollateralToken, 36 - collateralToken.decimals),
        collateral: {
          address: term.collateralAddress,
          decimals: collateralToken.decimals,
          logo: `/img/crypto-logos/${collateralToken.symbol.toLowerCase()}.png`,
          name: collateralToken.symbol,
          symbol: collateralToken.symbol
        },
        currentDebt: norm(term.currentDebt),
        interestRate: norm(term.interestRate),
        label: term.label,
        maxDebtPerCollateralToken: norm(term.maxDebtPerCollateralToken),
        maxDelayBetweenPartialRepay: term.maxDelayBetweenPartialRepay,
        minPartialRepayPercent: norm(term.minPartialRepayPercent),
        openingFee: norm(term.openingFee),
        status: term.status,
        debtCeiling: norm(term.debtCeiling),
        gaugeWeight: norm(term.gaugeWeight),
        issuance: norm(term.issuance),
        totalTypeWeight: norm(term.totalWeightForMarket),
        termSurplusBuffer: norm(term.termSurplusBuffer),
        activeLoans: loansForTerm.filter((_) => _.status != LoanStatus.CLOSED).length
      });
    }

    return response;
  }

  static async GetLoans(marketId: number): Promise<LoansApiResponse> {
    const loansFileName = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'loans.json');
    const termsFileName = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'terms.json');

    if (!fs.existsSync(loansFileName)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    }

    if (!fs.existsSync(termsFileName)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    }

    const loansFile: LoansFileStructure = ReadJSON(loansFileName);
    const termsFile: LendingTermsFileStructure = ReadJSON(termsFileName);
    const response: LoansApiResponse = {
      updateBlock: loansFile.updateBlock,
      updated: loansFile.updated,
      updatedHuman: loansFile.updatedHuman,
      loans: []
    };

    for (const loan of loansFile.loans) {
      const termForLoan = termsFile.terms.find((_) => _.termAddress == loan.lendingTermAddress);
      if (!termForLoan) {
        throw new Error(`Data mismatch with term ${loan.lendingTermAddress} for loan ${loan.id}`);
      }
      const collateralToken = getTokenByAddress(termForLoan.collateralAddress);

      response.loans.push({
        borrowAmount: norm(loan.borrowAmount),
        borrowCreditMultiplier: norm(loan.borrowCreditMultiplier),
        borrower: loan.borrowerAddress,
        closeTime: loan.closeTime,
        callTime: loan.callTime,
        id: loan.id,
        collateral: termForLoan.collateralSymbol,
        interestRate: norm(termForLoan.interestRate, 18),
        borrowRatio: norm(termForLoan.maxDebtPerCollateralToken, 36 - collateralToken.decimals),
        termAddress: loan.lendingTermAddress,
        collateralAmount: norm(loan.collateralAmount, collateralToken.decimals),
        borrowTime: loan.originationTime,
        txHashClose: loan.txHashClose,
        callDebt: norm(loan.debtWhenSeized),
        txHashOpen: loan.txHashOpen,
        loanDebt: norm(loan.loanDebt),
        debtRepaid: norm(loan.debtRepaid)
      });
    }

    return response;
  }

  static async GetActivity(marketId: number): Promise<LastActivityApiResponse> {
    const activityFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'last-activity.json');
    if (!fs.existsSync(activityFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    } else {
      const activityFile: LastActivityFileStructure = ReadJSON(activityFilename);

      const response: LastActivityApiResponse = activityFile;

      return response;
    }
  }

  static async GetAuctions(marketId: number): Promise<AuctionsApiReponse> {
    const auctionsFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'auctions.json');
    const auctionHousesFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'auction-houses.json');
    if (!fs.existsSync(auctionsFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    }

    if (!fs.existsSync(auctionHousesFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    }

    const auctionFile: AuctionsFileStructure = ReadJSON(auctionsFilename);
    const auctionHousesFile: AuctionHousesFileStructure = ReadJSON(auctionHousesFilename);

    const response: AuctionsApiReponse = {
      updated: auctionFile.updated,
      updateBlock: auctionFile.updateBlock,
      updatedHuman: auctionFile.updatedHuman,
      auctions: auctionFile.auctions,
      auctionHouses: auctionHousesFile.auctionHouses
    };

    return response;
  }

  static async GetTokensInfos(marketId: number): Promise<TokensApiInfo[]> {
    const coinDetails: TokensApiInfo[] = [];

    const llamaNetwork = NETWORK == 'ARBITRUM' ? 'arbitrum' : 'ethereum';

    const tokenIds = getAllTokens()
      .map((_) => `${llamaNetwork}:${_.mainnetAddress || _.address}`)
      .join(',');

    const llamaUrl = `https://coins.llama.fi/prices/current/${tokenIds}?searchWidth=4h`;

    const priceResponse = await HttpGet<DefiLlamaPriceResponse>(llamaUrl);

    for (const token of getAllTokens()) {
      const llamaPrice = priceResponse.coins[`${llamaNetwork}:${token.mainnetAddress || token.address}`]
        ? priceResponse.coins[`${llamaNetwork}:${token.mainnetAddress || token.address}`].price
        : 0;

      coinDetails.push({
        address: token.address,
        decimals: token.decimals,
        name: token.symbol,
        symbol: token.symbol,
        price: llamaPrice
      });
    }

    return coinDetails;
  }
}

export default MarketDataController;
