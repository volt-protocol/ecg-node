import express, { Request, Response } from 'express';
import SimpleCacheService from '../../services/cache/CacheService';
import MarketDataController from '../controllers/MarketDataController';

const router = express.Router();

const CACHE_DURATION = 10 * 1000;

/**
 * @openapi
 * /api/markets/{marketId}/terms:
 *   get:
 *     tags:
 *      - market
 *     description: Get all terms for a marketid (live and deprecated)
 *     parameters:
 *       - in: path
 *         name: marketId
 *         schema:
 *           type: number
 *         required: true
 *         description: The market id
 *     responses:
 *       200:
 *         description: Get all terms for a marketid (live and deprecated)
 *       404:
 *         description: market id not found
 */
router.get('/:marketId/terms', async (req: Request, res: Response) => {
  try {
    const marketId = Number(req.params.marketId);
    const cacheKey = `/markets/${marketId}/terms`;
    const data = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => MarketDataController.GetTermsInfo(marketId),
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
 * /api/markets/{marketId}/proposalsParams:
 *   get:
 *     tags:
 *      - market
 *     description: Get all  params for a marketid (active and closed)
 *     parameters:
 *       - in: path
 *         name: marketId
 *         schema:
 *           type: number
 *         required: true
 *         description: The market id
 *     responses:
 *       200:
 *         description: Get all proposals params for a marketid (active and closed)
 *       404:
 *         description: market id not found
 */
router.get('/:marketId/proposalsParams', async (req: Request, res: Response) => {
  try {
    const marketId = Number(req.params.marketId);
    const cacheKey = `/markets/${marketId}/proposalsParams`;
    const data = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => MarketDataController.GetProposalParams(marketId),
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
