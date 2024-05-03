import fs from 'fs';
import path from 'path';
import { GLOBAL_DATA_DIR } from '../../utils/Constants';
import { GetProtocolData, ReadJSON } from '../../utils/Utils';
import { LendingTermsApiResponse } from '../model/LendingTermsResponse';
import { LendingTermsFileStructure } from '../../model/LendingTerm';
import { norm } from '../../utils/TokenUtils';
import { GetFullConfigFile, getAllTokens } from '../../config/Config';
import { TokensApiInfo } from '../model/TokensResponse';
import { AuctionsApiReponse } from '../model/AuctionsApiReponse';
import { AuctionsFileStructure } from '../../model/Auction';
import { AuctionHousesFileStructure } from '../../model/AuctionHouse';
import { LastActivityFileStructure } from '../../model/LastActivity';
import { LastActivityApiResponse } from '../model/LastActivityApiResponse';
import { LoanStatus, LoansFileStructure } from '../../model/Loan';
import { LoansApiResponse } from '../model/LoansApiResponse';
import { ProposalsFileStructure } from '../../model/Proposal';
import { ProposalsApiResponse } from '../model/ProposalsApiResponse';
import { GetTokenPrice, GetTokenPriceMulti } from '../../utils/Price';
import { AirdropDataResponse } from '../model/AirdropDataResponse';
import { HistoricalData, HistoricalDataMulti } from '../../model/HistoricalData';
import { CreditTransferFile } from '../../model/CreditTransfer';
import { MarketDataResponse } from '../model/MarketData';
import { ProtocolData, ProtocolDataFileStructure } from '../../model/ProtocolData';

class MarketDataController {
  static async GetMarketData(marketId: number): Promise<MarketDataResponse> {
    const protocolDataFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'protocol-data.json');
    const creditTransfersFilename = path.join(
      GLOBAL_DATA_DIR,
      `market_${marketId}`,
      'history',
      'credit-transfers.json'
    );

    if (!fs.existsSync(protocolDataFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    }

    if (!fs.existsSync(creditTransfersFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    }
    const protocolDataFile: ProtocolDataFileStructure = ReadJSON(protocolDataFilename);
    const creditTransferFile: CreditTransferFile = ReadJSON(creditTransfersFilename);

    return {
      creditMultiplier: protocolDataFile.data.creditMultiplier.toString(10),
      creditHolderCount: creditTransferFile.creditHolderCount
    };
  }

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
      const loansForTerm = loansFile.loans.filter((_) => _.lendingTermAddress == term.termAddress);
      response.terms.push({
        address: term.termAddress,
        availableDebt: norm(term.availableDebt),
        borrowRatio: norm(term.maxDebtPerCollateralToken, 36 - term.collateralDecimals),
        collateral: {
          address: term.collateralAddress,
          decimals: term.collateralDecimals,
          logo: `/img/crypto-logos/${term.collateralSymbol.toLowerCase()}.png`,
          name: term.collateralSymbol,
          symbol: term.collateralSymbol
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

      response.loans.push({
        borrowAmount: norm(loan.borrowAmount),
        borrowCreditMultiplier: norm(loan.borrowCreditMultiplier),
        borrower: loan.borrowerAddress,
        closeTime: loan.closeTime,
        callTime: loan.callTime,
        id: loan.id,
        collateral: termForLoan.collateralSymbol,
        interestRate: norm(termForLoan.interestRate, 18),
        borrowRatio: norm(termForLoan.maxDebtPerCollateralToken, 36 - termForLoan.collateralDecimals),
        termAddress: loan.lendingTermAddress,
        collateralAmount: norm(loan.collateralAmount, termForLoan.collateralDecimals),
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

  static async GetProposals(marketId: number): Promise<ProposalsApiResponse> {
    const proposalsFilename = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'proposals.json');
    if (!fs.existsSync(proposalsFilename)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    }

    const proposalsFile: ProposalsFileStructure = ReadJSON(proposalsFilename);

    const response: ProposalsApiResponse = {
      updated: proposalsFile.updated,
      updateBlock: proposalsFile.updateBlock,
      updatedHuman: proposalsFile.updatedHuman,
      proposals: proposalsFile.proposals
    };

    return response;
  }

  static async GetTokensInfos(marketId: number): Promise<TokensApiInfo[]> {
    const coinDetails: TokensApiInfo[] = [];

    const termsFileName = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'terms.json');

    if (!fs.existsSync(termsFileName)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    }
    const termsFile: LendingTermsFileStructure = ReadJSON(termsFileName);

    const allTokens = getAllTokens(); // all tokens from the config
    // add all tokens from lending terms that might be unknown

    for (const term of termsFile.terms) {
      if (!allTokens.some((_) => _.address.toLowerCase() == term.collateralAddress.toLowerCase())) {
        allTokens.push({
          address: term.collateralAddress,
          symbol: term.collateralSymbol,
          decimals: term.collateralDecimals,
          permitAllowed: false
        });
      }
    }

    const tokenPrices = await GetTokenPriceMulti(allTokens.map((_) => _.address));

    for (const token of allTokens) {
      coinDetails.push({
        address: token.address,
        decimals: token.decimals,
        name: token.symbol,
        symbol: token.symbol,
        price: tokenPrices[token.address]
      });
    }

    return coinDetails;
  }
}

export default MarketDataController;
