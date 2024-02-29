import express, { Request, Response } from 'express';
import HistoricalDataController from '../controllers/HistoricalDataController';
import SimpleCacheService from '../../utils/CacheService';

const router = express.Router();

const HISTORICAL_CACHE_DURATION = 10 * 60 * 1000;

/**
 * @openapi
 * /api/history/CreditSupply:
 *   get:
 *     tags:
 *      - history
 *     description: Gets the credit supply history
 *     responses:
 *       200:
 *         description: Gets the credit supply history
 *         content:
 *           application/json:
 *            schema:
 *              type: object
 *              properties:
 *                timestamps:
 *                  type: array
 *                  items:
 *                    type: number
 *                values:
 *                  type: array
 *                  items:
 *                    type: number
 */
router.get('/CreditSupply', async (_: Request, res: Response) => {
  try {
    const cacheKey = '/api/history/CreditSupply';
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => HistoricalDataController.GetCreditSupplyHistory(),
      HISTORICAL_CACHE_DURATION
    );
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /api/history/CreditTotalIssuance:
 *   get:
 *     tags:
 *      - history
 *     description: Gets the total issuance history
 *     responses:
 *       200:
 *         description: Gets the total issuance history
 *         content:
 *           application/json:
 *            schema:
 *              type: object
 *              properties:
 *                timestamps:
 *                  type: array
 *                  items:
 *                    type: number
 *                values:
 *                  type: array
 *                  items:
 *                    type: number
 */
router.get('/CreditTotalIssuance', async (_: Request, res: Response) => {
  try {
    const cacheKey = '/api/history/CreditTotalIssuance';
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => HistoricalDataController.GetCreditTotalIssuance(),
      HISTORICAL_CACHE_DURATION
    );
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /api/history/AverageInterestRate:
 *   get:
 *     tags:
 *      - history
 *     description: Gets the average interest rate history
 *     responses:
 *       200:
 *         description: Gets the average interest rate history
 *         content:
 *           application/json:
 *            schema:
 *              type: object
 *              properties:
 *                timestamps:
 *                  type: array
 *                  items:
 *                    type: number
 *                values:
 *                  type: array
 *                  items:
 *                    type: number
 */
router.get('/AverageInterestRate', async (_: Request, res: Response) => {
  try {
    const cacheKey = '/api/history/AverageInterestRate';
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => HistoricalDataController.GetAverageInterestRate(),
      HISTORICAL_CACHE_DURATION
    );
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /api/history/TVL:
 *   get:
 *     tags:
 *      - history
 *     description: Gets the TVL of the contract (sum of collateral in all terms)
 *     responses:
 *       200:
 *         description: Gets the TVL of the contract (sum of collateral in all terms)
 *         content:
 *           application/json:
 *            schema:
 *              type: object
 *              properties:
 *                timestamps:
 *                  type: array
 *                  items:
 *                    type: number
 *                values:
 *                  type: array
 *                  items:
 *                    type: number
 */
router.get('/TVL', async (_: Request, res: Response) => {
  try {
    const cacheKey = '/api/history/TVL';
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => HistoricalDataController.GetTVL(),
      HISTORICAL_CACHE_DURATION
    );
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /api/history/DebtCeilingIssuance/{termAddress}:
 *   get:
 *     tags:
 *      - history
 *     description: Gets the Debt ceiling and issuance history of a terms
 *     parameters:
 *       - in: path
 *         name: termAddress
 *         schema:
 *           type: string
 *         required: true
 *         description: The term address to get the history for
 *     responses:
 *       200:
 *         description: Gets the Debt ceiling and issuance history of a terms
 *         content:
 *           application/json:
 *            schema:
 *              type: object
 *              properties:
 *                timestamps:
 *                  type: array
 *                  items:
 *                    type: number
 *                values:
 *                  type: object
 *                  properties:
 *                    debtCeiling:
 *                      type: array
 *                      items:
 *                        type: number
 *                    issuance:
 *                      type: array
 *                      items:
 *                        type: number
 *       404:
 *         description: Term address not found
 */
router.get('/DebtCeilingIssuance/:termAddress', async (req: Request, res: Response) => {
  try {
    const termAddress = req.params.termAddress;
    const cacheKey = `/api/history/DebtCeilingIssuance/${termAddress}`;
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => HistoricalDataController.GetDebtCeilingIssuance(termAddress),
      HISTORICAL_CACHE_DURATION
    );
    if (!history) {
      res.status(404).json({ error: `Cannot find term ${termAddress}` });
    }
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /api/history/GaugeWeight/{termAddress}:
 *   get:
 *     tags:
 *      - history
 *     description: Get the gauge weight history of a lending term
 *     parameters:
 *       - in: path
 *         name: termAddress
 *         schema:
 *           type: string
 *         required: true
 *         description: The term address to get the history for
 *     responses:
 *       200:
 *         description:  Get the gauge weight history of a lending term
 *         content:
 *           application/json:
 *            schema:
 *              type: object
 *              properties:
 *                timestamps:
 *                  type: array
 *                  items:
 *                    type: number
 *                values:
 *                  type: array
 *                  items:
 *                    type: number
 *       404:
 *         description: Term address not found
 */
router.get('/GaugeWeight/:termAddress', async (req: Request, res: Response) => {
  try {
    const termAddress = req.params.termAddress;
    const cacheKey = `/api/history/GaugeWeight/${termAddress}`;
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => HistoricalDataController.GetGaugeWeight(termAddress),
      HISTORICAL_CACHE_DURATION
    );
    if (!history) {
      res.status(404).json({ error: `Cannot find term ${termAddress}` });
    }
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
