import * as dotenv from 'dotenv';
import winston from 'winston';
import LokiTransport from 'winston-loki';
dotenv.config();

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.printf(
        (log) =>
          `${process.env.APP_NAME} | ${process.env.MARKET_ID ? `MARKET ${process.env.MARKET_ID} | ` : ''}${
            log.level
          } | ${log.message}`
      ),
      level: 'debug'
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
      labels: getDefaultMetadata(),
      basicAuth: `${process.env.LOKI_LOGIN}:${process.env.LOKI_PWD}`,
      useWinstonMetaAsLabels: false,
      batching: true
    })
  );
}

function getDefaultMetadata() {
  return {
    app: process.env.APP_NAME,
    market: process.env.MARKET_ID
  };
}

export default logger;

///// OLD CODE

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Log(msg: string, ...args: any[]) {
  const marketId = process.env.MARKET_ID;
  if (marketId) {
    console.log(`[${process.title}] | MARKET ${marketId} | ${msg}`, ...args);
  } else {
    console.log(`[${process.title}] | ${msg}`, ...args);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Warn(msg: string, ...args: any[]) {
  const marketId = process.env.MARKET_ID;
  if (marketId) {
    console.warn(`[${process.title}] | MARKET ${marketId} | ${msg}`, ...args);
  } else {
    console.warn(`[${process.title}] | ${msg}`, ...args);
  }
}
