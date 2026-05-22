import express from 'express';
import cors from 'cors';
import { authRoutes } from './routes/auth.routes.js';
import { studentRoutes } from './routes/student.routes.js';
import { saleRoutes } from './routes/sale.routes.js';
import { menuRoutes } from './routes/menu.routes.js';
import { ApiError } from './utils/ApiError.js';

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/menu', menuRoutes);

app.use((req, res, next) => {
  next(new ApiError(404, 'Route not found'));
});

app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      details: err.details ?? undefined,
    });
  }

  if (err?.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: Object.values(err.errors).map((entry) => entry.message),
    });
  }

  if (err?.name === 'CastError') {
    return res.status(400).json({
      error: 'Invalid identifier',
    });
  }

  if (err?.code === 11000) {
    const field = Object.keys(err.keyValue ?? {})[0] ?? 'field';
    return res.status(409).json({
      error: `${field} already exists`,
    });
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
