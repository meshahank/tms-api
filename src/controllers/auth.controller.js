import jwt from 'jsonwebtoken';
import { z } from 'zod';
import Admin from '../models/Admin.js';
import { ApiError } from '../utils/ApiError.js';

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function login(req, res, next) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'Validation failed', parsed.error.flatten());
    }

    const username = parsed.data.username.toLowerCase();
    const admin = await Admin.findOne({ username }).select('+password');

    if (!admin) {
      throw new ApiError(401, 'Invalid credentials');
    }

    const passwordMatches = await admin.checkPassword(parsed.data.password);
    if (!passwordMatches) {
      throw new ApiError(401, 'Invalid credentials');
    }

    if (!process.env.JWT_SECRET) {
      throw new ApiError(500, 'JWT secret is not configured');
    }

    const token = jwt.sign(
      { id: admin._id.toString(), username: admin.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' },
    );

    res.status(200).json({
      token,
      admin: { username: admin.username },
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(req, res) {
  res.status(200).json({ message: 'Logged out successfully' });
}
