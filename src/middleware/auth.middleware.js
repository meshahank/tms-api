import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/ApiError.js';

export function protect(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    return next(new ApiError(401, 'Not authenticated'));
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return next(new ApiError(500, 'JWT secret is not configured'));
    }

    req.admin = jwt.verify(token, secret);
    next();
  } catch {
    next(new ApiError(401, 'Token invalid or expired'));
  }
}
