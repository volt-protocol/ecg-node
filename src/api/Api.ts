import express, { Express } from 'express';

import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import loggerMiddleware from './middlewares/LoggerMiddleware';
import historycalDataRoutes from './routes/HistoricalDataRoutes';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

import dotenv from 'dotenv';
import { Log } from '../utils/Logger';
dotenv.config();
const port = process.env.API_PORT || 17777;

process.title = 'ECG_NODE_API';

const app: Express = express();

app.use(cors());
app.use(helmet());
app.use(compression());
app.disable('x-powered-by');
app.use(loggerMiddleware);

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ECG-Node Api documentation',
      version: '1.0.0'
    },
    tags: [
      {
        name: 'history',
        description: 'History endpoints'
      }
    ]
  },
  apis: ['./src/api/routes/*.ts', './api/routes/*.js'] // files containing annotations as above
};

const openapiSpecification = swaggerJsdoc(options);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpecification));

app.use('/api/history/', historycalDataRoutes);

app.listen(port, () => {
  Log(`⚡️[server]: Server is running at http://localhost:${port}`);
});

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function cleanup() {
  // do cleanup if needed
  Log('shutdown requested');
  process.exit();
}
