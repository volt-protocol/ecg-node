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
    const history = await HistoricalDataController.GetTVL();
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /api/history/DebtCeilingIssuance:
 *   get:
 *     tags:
 *      - history
 *     description: Gets the Debt ceiling and issuance history of all terms
 *     responses:
 *       200:
 *         description: Gets the Debt ceiling and issuance history of all terms
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
 *                  additionalProperties:
 *                    type: array
 *                    items:
 *                      type: number
 */
router.get('/DebtCeilingIssuance', async (_: Request, res: Response) => {
  try {
    const history = await HistoricalDataController.GetDebtCeilingIssuance();
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
