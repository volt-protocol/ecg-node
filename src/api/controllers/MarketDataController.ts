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

class MarketDataController {
  static async GetTermsInfo(marketId: number): Promise<LendingTermsApiResponse> {
    const termsFileName = path.join(GLOBAL_DATA_DIR, `market_${marketId}`, 'terms.json');
    if (!fs.existsSync(termsFileName)) {
      throw new Error(`DATA FILE NOT FOUND FOR MARKET ${marketId}`);
    } else {
      const termsFile: LendingTermsFileStructure = ReadJSON(termsFileName);

      const response: LendingTermsApiResponse = {
        updated: termsFile.updated,
        updatedHuman: termsFile.updatedHuman,
        terms: []
      };

      for (const term of termsFile.terms) {
        const collateralToken = getTokenByAddress(term.collateralAddress);
        response.terms.push({
          address: term.termAddress,
          availableDebt: norm(term.availableDebt),
          borrowRatio: norm(term.borrowRatio),
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
          status: term.status
        });
      }

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
