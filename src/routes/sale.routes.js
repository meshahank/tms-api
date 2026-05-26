import { Router } from 'express';
import { createSale, getDailySummary, exportSalesReport, getItemAnalytics } from '../controllers/sale.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/summary/today', protect, getDailySummary);
router.get('/report/export', protect, exportSalesReport);
router.get('/analytics/items', protect, getItemAnalytics);
router.post('/', protect, createSale);

export const saleRoutes = router;
