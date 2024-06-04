import * as dotenv from 'dotenv';
import winston from 'winston';
import LokiTransport from 'winston-loki';
dotenv.config();
import os from 'os';

const logger = winston.createLogger({
  level: 'silly',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.printf(
        (log) =>
          `${process.env.APP_NAME} | ${process.env.MARKET_ID ? `MARKET ${process.env.MARKET_ID} | ` : ''}${
            log.level
          } | ${log.message}`
      ),
      level: 'silly'
    })
  ]
});

if (process.env.LOKI_URI && process.env.LOKI_LOGIN && process.env.LOKI_PWD) {
  logger.add(
    new LokiTransport({
      level: 'debug',
      host: process.env.LOKI_URI,
      format: winston.format.printf((log) => log.message),
      json: true,
      labels: getLokiLabels(),
      basicAuth: `${process.env.LOKI_LOGIN}:${process.env.LOKI_PWD}`,
      useWinstonMetaAsLabels: false,
      batching: true
    })
  );
}

function getLokiLabels() {
  return {
    app: process.env.APP_NAME,
    market: process.env.MARKET_ID,
    host: os.hostname()
  };
}

export default logger;
