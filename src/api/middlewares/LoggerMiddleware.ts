import { Request, Response, NextFunction } from 'express';
import { Log } from '../../utils/Logger';

const loggerMiddleware = (req: Request, _: Response, next: NextFunction) => {
  Log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
};

export default loggerMiddleware;
