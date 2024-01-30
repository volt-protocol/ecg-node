import express, { Express } from 'express';

import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import loggerMiddleware from './middlewares/LoggerMiddleware';
import historycalDataRoutes from './routes/HistoricalDataRoutes';
import dotenv from 'dotenv';
dotenv.config();
const port = process.env.API_PORT || 17777;

const app: Express = express();

app.use(cors());
app.use(helmet());
app.use(compression());
app.disable('x-powered-by');
app.use(loggerMiddleware);

app.use('/api/history/', historycalDataRoutes);

app.listen(port, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function cleanup() {
  // do cleanup if needed
  console.log('shutdown requested');
  process.exit();
}
