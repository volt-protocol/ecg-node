import express, { Request, Response } from 'express';
import SimpleCacheService from '../../services/cache/CacheService';
import MarketDataController from '../controllers/MarketDataController';
import ProtocolDataController from '../controllers/ProtocolDataController';

const router = express.Router();

const CACHE_DURATION = 30 * 60 * 1000;

/**
 * @openapi
 * /api/protocol/airdropdata:
 *   get:
 *     tags:
 *      - protocol
 *     description: Get latest data used to compute airdrop
 *     responses:
 *       200:
 *         description: Get latest data used to compute airdrop
 */
router.get('/airdropdata', async (req: Request, res: Response) => {
  try {
    const cacheKey = '/airdropdata';
    const data = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => ProtocolDataController.GetAirdropData(),
      CACHE_DURATION
    );
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', msg: (error as Error).message });
  }
});

/**
 * @openapi
 * /api/protocol/prices:
 *   get:
 *     tags:
 *      - protocol
 *     description: Get latest price of all assets in the protocol
 *     responses:
 *       200:
 *         description: Get latest price of all assets in the protocol
 */
router.get('/prices', async (req: Request, res: Response) => {
  try {
    const data = await ProtocolDataController.GetAllPrices();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', msg: (error as Error).message });
  }
});
export default router;
