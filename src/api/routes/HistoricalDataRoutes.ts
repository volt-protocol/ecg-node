import express, { Request, Response } from 'express';
import HistoricalDataController from '../controllers/HistoricalDataController';

const router = express.Router();

/**
 * @openapi
 * /api/history/creditsupply:
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
router.get('/creditsupply', async (_: Request, res: Response) => {
  try {
    const history = await HistoricalDataController.GetCreditSupplyHistory();
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
