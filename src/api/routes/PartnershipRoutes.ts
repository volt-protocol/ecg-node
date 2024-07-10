import express, { Request, Response } from 'express';
import SimpleCacheService from '../../services/cache/CacheService';
import MarketDataController from '../controllers/MarketDataController';
import PartnershipController from '../controllers/PartnershipController';

const router = express.Router();

const CACHE_DURATION = 10 * 1000;

/**
 * @openapi
 * /api/partnership/etherfi:
 *   get:
 *     tags:
 *      - partnership
 *     description: Get etherfi required data
 *     parameters:
 *       - in: query
 *         name: blockNumber
 *         schema:
 *           type: integer
 *         required: true
 *         description: The blocknumber
 *       - in: query
 *         name: addresses
 *         schema:
 *           type: string
 *         required: false
 *         description: List of addresses (comma separated) to fetch
 *     responses:
 *       200:
 *         description:  Get etherfi required data
 *       400:
 *         description: bad request
 */
router.get('/etherfi', async (req: Request, res: Response) => {
  try {
    const blockNumber = Number(req.query.blockNumber);
    if (!blockNumber || Number.isNaN(blockNumber)) {
      res.status(400).json({ error: 'Blocknumber is mandatory' });
      return;
    }
    const addressesParams = req.query.addresses?.toString();
    let addresses: string[] = [];
    if (addressesParams) {
      addresses = addressesParams.split(',');
    }

    const weETHAddress = '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe';

    const data = await PartnershipController.GetCollateralData(blockNumber, addresses, weETHAddress);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', msg: (error as Error).message });
  }
});

// route not shown on api docs
router.get('/collateralHolders', async (req: Request, res: Response) => {
  try {
    const blockNumber = req.query.blockNumber ? Number(req.query.blockNumber) : undefined;
    const addressesParams = req.query.addresses?.toString();
    let addresses: string[] = [];
    if (addressesParams) {
      addresses = addressesParams.split(',');
    }

    const tokenAddress = req.query.tokenAddress as string;
    if (!tokenAddress) {
      res.status(400).json({ error: 'tokenAddress is mandatory' });
      return;
    }

    const data = await PartnershipController.GetCollateralData(blockNumber, addresses, tokenAddress);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', msg: (error as Error).message });
  }
});

// route not shown on api docs
router.get('/borrowerWeights', async (req: Request, res: Response) => {
  try {
    const collateralToken = req.query.collateralToken as string;
    if (!collateralToken) {
      res.status(400).json({ error: 'collateralToken is mandatory' });
      return;
    }
    const startDate = req.query.startDate as string;
    if (!startDate) {
      res.status(400).json({ error: 'startDate is mandatory' });
      return;
    }
    const endDate = req.query.endDate as string;
    if (!endDate) {
      res.status(400).json({ error: 'endDate is mandatory' });
      return;
    }

    const data = await PartnershipController.GetBorrowerWeightsData(collateralToken, startDate, endDate);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', msg: (error as Error).message });
  }
});

/**
 * @openapi
 * /api/markets/{marketId}/marketdata:
 *   get:
 *     tags:
 *      - market
 *     description: Get all market data
 *     parameters:
 *       - in: path
 *         name: marketId
 *         schema:
 *           type: number
 *         required: true
 *         description: The market id
 *     responses:
 *       200:
 *         description: Get all market data
 *       404:
 *         description: market id not found
 */
router.get('/:marketId/marketdata', async (req: Request, res: Response) => {
  try {
    const marketId = Number(req.params.marketId);
    const cacheKey = `/markets/${marketId}/marketdata`;
    const data = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => MarketDataController.GetMarketData(marketId),
      CACHE_DURATION
    );
    if (!data) {
      res.status(404).json({ error: `Cannot find market ${marketId}` });
    }
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', msg: (error as Error).message });
  }
});

/**
 * @openapi
 * /api/markets/{marketId}/loans:
 *   get:
 *     tags:
 *      - market
 *     description: Get all loans for a marketid (active or not)
 *     parameters:
 *       - in: path
 *         name: marketId
 *         schema:
 *           type: number
 *         required: true
 *         description: The market id
 *     responses:
 *       200:
 *         description:  Get all loans for a marketid (active or not)
 *       404:
 *         description: market id not found
 */
router.get('/:marketId/loans', async (req: Request, res: Response) => {
  try {
    const marketId = Number(req.params.marketId);
    const cacheKey = `/markets/${marketId}/loans`;
    const data = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => MarketDataController.GetLoans(marketId),
      CACHE_DURATION
    );
    if (!data) {
      res.status(404).json({ error: `Cannot find market ${marketId}` });
    }
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', msg: (error as Error).message });
  }
});

/**
 * @openapi
 * /api/markets/{marketId}/auctions:
 *   get:
 *     tags:
 *      - market
 *     description: Get all auctions for a marketid (active and closed)
 *     parameters:
 *       - in: path
 *         name: marketId
 *         schema:
 *           type: number
 *         required: true
 *         description: The market id
 *     responses:
 *       200:
 *         description: Get all auctions for a marketid (active and closed)
 *       404:
 *         description: market id not found
 */
router.get('/:marketId/auctions', async (req: Request, res: Response) => {
  try {
    const marketId = Number(req.params.marketId);
    const cacheKey = `/markets/${marketId}/auctions`;
    const data = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => MarketDataController.GetAuctions(marketId),
      CACHE_DURATION
    );
    if (!data) {
      res.status(404).json({ error: `Cannot find market ${marketId}` });
    }
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', msg: (error as Error).message });
  }
});

/**
 * @openapi
 * /api/markets/{marketId}/proposals:
 *   get:
 *     tags:
 *      - market
 *     description: Get all proposals for a marketid (active and closed)
 *     parameters:
 *       - in: path
 *         name: marketId
 *         schema:
 *           type: number
 *         required: true
 *         description: The market id
 *     responses:
 *       200:
 *         description: Get all proposals for a marketid (active and closed)
 *       404:
 *         description: market id not found
 */
router.get('/:marketId/proposals', async (req: Request, res: Response) => {
  try {
    const marketId = Number(req.params.marketId);
    const cacheKey = `/markets/${marketId}/proposals`;
    const data = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => MarketDataController.GetProposals(marketId),
      CACHE_DURATION
    );
    if (!data) {
      res.status(404).json({ error: `Cannot find market ${marketId}` });
    }
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', msg: (error as Error).message });
  }
});

/**
 * @openapi
 * /api/markets/{marketId}/tokens:
 *   get:
 *     tags:
 *      - market
 *     description: Get all tokens info (with price) for a market
 *     parameters:
 *       - in: path
 *         name: marketId
 *         schema:
 *           type: number
 *         required: true
 *         description: The market id
 *     responses:
 *       200:
 *         description: Get all tokens info (with price) for a market
 *       404:
 *         description: market id not found
 */
router.get('/:marketId/tokens', async (req: Request, res: Response) => {
  try {
    const marketId = Number(req.params.marketId);
    const cacheKey = `/markets/${marketId}/tokens`;
    const data = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => MarketDataController.GetTokensInfos(marketId),
      5 * 60 * 1000 // 5 min token cache duration for pricing
    );
    if (!data) {
      res.status(404).json({ error: `Cannot find market ${marketId}` });
    }
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', msg: (error as Error).message });
  }
});

/**
 * @openapi
 * /api/markets/{marketId}/activity:
 *   get:
 *     tags:
 *      - market
 *     description: Get last week activity for market
 *     parameters:
 *       - in: path
 *         name: marketId
 *         schema:
 *           type: number
 *         required: true
 *         description: The market id
 *     responses:
 *       200:
 *         description: Get last week activity for market
 *       404:
 *         description: market id not found
 */
router.get('/:marketId/activity', async (req: Request, res: Response) => {
  try {
    const marketId = Number(req.params.marketId);
    const cacheKey = `/markets/${marketId}/activity`;
    const data = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => MarketDataController.GetActivity(marketId),
      CACHE_DURATION
    );
    if (!data) {
      res.status(404).json({ error: `Cannot find market ${marketId}` });
    }
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', msg: (error as Error).message });
  }
});

export default router;
