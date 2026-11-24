import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class AppError extends Error {
  status: number;
  details?: Record<string, string>;
  constructor(status: number, message: string, details?: Record<string, string>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg = 'Invalid request.', details?: Record<string, string>) => new AppError(400, msg, details);
export const forbidden = (msg = 'You do not have permission to perform this action.') => new AppError(403, msg);
export const notFound = (msg = 'Record not found.') => new AppError(404, msg);
export const conflict = (msg: string, details?: Record<string, string>) => new AppError(409, msg, details);

export const asyncH = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export const sha256 = (v: string | Buffer) => crypto.createHash('sha256').update(v).digest('hex');

export const toId = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
};
