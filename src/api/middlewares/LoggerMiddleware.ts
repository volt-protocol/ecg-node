import { Request, Response, NextFunction } from 'express';

const loggerMiddleware = (req: Request, _: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
};

export default loggerMiddleware;
