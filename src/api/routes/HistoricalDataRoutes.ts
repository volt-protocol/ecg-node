import express, { Request, Response } from 'express';
import HistoricalDataController from '../controllers/HistoricalDataController';

const router = express.Router();

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
    const history = await HistoricalDataController.GetCreditSupplyHistory();
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
    const history = await HistoricalDataController.GetCreditTotalIssuance();
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
    const history = await HistoricalDataController.GetAverageInterestRate();
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
