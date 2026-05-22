import { Router } from 'express';
import { createSale } from '../controllers/sale.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = Router();

router.post('/', protect, createSale);

export const saleRoutes = router;
