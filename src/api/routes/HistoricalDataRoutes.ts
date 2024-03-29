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
router.get('/CreditSupply', async (req: Request, res: Response) => {
  try {
    const cacheKey = '/api/history/CreditSupply';
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => HistoricalDataController.GetCreditSupplyHistory(getMarketIdFromRequest(req)),
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
router.get('/CreditTotalIssuance', async (req: Request, res: Response) => {
  try {
    const cacheKey = '/api/history/CreditTotalIssuance';
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => HistoricalDataController.GetCreditTotalIssuance(getMarketIdFromRequest(req)),
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
router.get('/AverageInterestRate', async (req: Request, res: Response) => {
  try {
    const cacheKey = '/api/history/AverageInterestRate';
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => HistoricalDataController.GetAverageInterestRate(getMarketIdFromRequest(req)),
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
router.get('/TVL', async (req: Request, res: Response) => {
  try {
    const cacheKey = '/api/history/TVL';
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => HistoricalDataController.GetTVL(getMarketIdFromRequest(req)),
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
      () => HistoricalDataController.GetDebtCeilingIssuance(getMarketIdFromRequest(req), termAddress),
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
      () => HistoricalDataController.GetGaugeWeight(getMarketIdFromRequest(req), termAddress),
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
 * /api/history/SurplusBuffer/{termAddress}:
 *   get:
 *     tags:
 *      - history
 *     description: Get the surplus buffer history of a lending term
 *     parameters:
 *       - in: path
 *         name: termAddress
 *         schema:
 *           type: string
 *         required: true
 *         description: The term address to get the history for
 *     responses:
 *       200:
 *         description:  Get the surplus buffer history of a lending term
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
router.get('/SurplusBuffer/:termAddress', async (req: Request, res: Response) => {
  try {
    const termAddress = req.params.termAddress;
    const cacheKey = `/api/history/SurplusBuffer/${termAddress}`;
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => HistoricalDataController.GetSurplusBuffer(getMarketIdFromRequest(req), termAddress),
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
 * /api/history/LoanBorrow:
 *   get:
 *     tags:
 *      - history
 *     description: Gets history of open loans and loan borrow value
 *     responses:
 *       200:
 *         description: Gets history of open loans and loan borrow value
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
 *                    openLoans:
 *                      type: array
 *                      items:
 *                        type: number
 *                    borrowValue:
 *                      type: array
 *                      items:
 *                        type: number
 */
router.get('/LoanBorrow', async (req: Request, res: Response) => {
  try {
    const cacheKey = '/api/history/LoanBorrow';
    const history = await SimpleCacheService.GetAndCache(
      cacheKey,
      () => HistoricalDataController.GetLoanBorrow(getMarketIdFromRequest(req)),
      HISTORICAL_CACHE_DURATION
    );
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

function getMarketIdFromRequest(req: Request) {
  let marketId = Number(req.params.marketId);
  if (!marketId || Number.isNaN(marketId)) {
    marketId = 1;
  }

  return marketId;
}

export default router;
