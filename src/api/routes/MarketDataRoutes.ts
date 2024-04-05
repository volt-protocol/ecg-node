import express, { Request, Response } from 'express';
import SimpleCacheService from '../../utils/CacheService';
import MarketDataController from '../controllers/MarketDataController';

const router = express.Router();

const CACHE_DURATION = 1 * 60 * 1000;

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
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => MarketDataController.GetTermsInfo(marketId),
      CACHE_DURATION
    );
    if (!history) {
      res.status(404).json({ error: `Cannot find market ${marketId}` });
    }
    res.status(200).json(history);
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
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => MarketDataController.GetTokensInfos(marketId),
      CACHE_DURATION
    );
    if (!history) {
      res.status(404).json({ error: `Cannot find market ${marketId}` });
    }
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', msg: (error as Error).message });
  }
});

export default router;
