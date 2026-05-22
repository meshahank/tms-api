import { Router } from 'express';
import { protect } from '../middleware/auth.middleware.js';
import {
  createMenuItem,
  deleteMenuItem,
  getMenuItems,
  updateMenuItem,
} from '../controllers/menu.controller.js';

const router = Router();

router.get('/', getMenuItems);
router.post('/', protect, createMenuItem);
router.patch('/:id', protect, updateMenuItem);
router.delete('/:id', protect, deleteMenuItem);

export const menuRoutes = router;
