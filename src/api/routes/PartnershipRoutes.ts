import express, { Request, Response } from 'express';
import PartnershipController from '../controllers/PartnershipController';

const router = express.Router();

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

export default router;
