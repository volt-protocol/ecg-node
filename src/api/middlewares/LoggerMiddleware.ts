import { Request, Response, NextFunction } from 'express';
import logger from '../../utils/Logger';

const loggerMiddleware = (req: Request, _: Response, next: NextFunction) => {
  logger.debug(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
};

export default loggerMiddleware;
