import express, { Request, Response } from 'express';
import HistoricalDataController from '../controllers/HistoricalDataController';

const router = express.Router();

// GET /history/creditsupply
router.get('/creditsupply', async (_: Request, res: Response) => {
  try {
    const history = await HistoricalDataController.GetCreditSupplyHistory();
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
