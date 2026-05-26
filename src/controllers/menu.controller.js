import mongoose from 'mongoose';
import { z } from 'zod';
import MenuItem from '../models/MenuItem.js';
import { ApiError } from '../utils/ApiError.js';

const menuItemSchema = z.object({
  name: z.string().trim().min(1),
  image: z.string().trim().min(1),
  price: z.coerce.number().finite().nonnegative(),
  isActive: z.boolean().optional().default(false),
}).strict();

const toggleSchema = z.object({
  isActive: z.boolean(),
}).strict();

const parseBoolean = z.preprocess((value) => {
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }

  return value;
}, z.boolean());

const menuIdSchema = z.object({
  id: z.string().min(1),
});

const menuQuerySchema = z.object({
  active: parseBoolean.optional(),
});

export async function getMenuItems(req, res, next) {
  try {
    const parsed = menuQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, 'Validation failed', parsed.error.flatten());
    }

    const filter = {};
    if (parsed.data.active === true) {
      filter.isActive = true;
    }

    const items = await MenuItem.find(filter).sort({ createdAt: -1 }).lean();
    res.status(200).json(items);
  } catch (error) {
    next(error);
  }
}

export async function createMenuItem(req, res, next) {
  try {
    const parsed = menuItemSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'Validation failed', parsed.error.flatten());
    }

    const item = await MenuItem.create(parsed.data);
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
}

export async function updateMenuItem(req, res, next) {
  try {
    const paramsResult = menuIdSchema.safeParse(req.params);
    if (!paramsResult.success) {
      throw new ApiError(400, 'Validation failed', paramsResult.error.flatten());
    }

    if (!mongoose.Types.ObjectId.isValid(paramsResult.data.id)) {
      throw new ApiError(400, 'Invalid menu item id');
    }

    const bodyResult = toggleSchema.safeParse(req.body);
    if (!bodyResult.success) {
      throw new ApiError(400, 'Validation failed', bodyResult.error.flatten());
    }

    const item = await MenuItem.findByIdAndUpdate(
      paramsResult.data.id,
      { $set: bodyResult.data },
      { new: true, runValidators: true },
    );

    if (!item) {
      throw new ApiError(404, 'Menu item not found');
    }

    res.status(200).json(item);
  } catch (error) {
    next(error);
  }
}

export async function deleteMenuItem(req, res, next) {
  try {
    const paramsResult = menuIdSchema.safeParse(req.params);
    if (!paramsResult.success) {
      throw new ApiError(400, 'Validation failed', paramsResult.error.flatten());
    }

    if (!mongoose.Types.ObjectId.isValid(paramsResult.data.id)) {
      throw new ApiError(400, 'Invalid menu item id');
    }

    const item = await MenuItem.findByIdAndDelete(paramsResult.data.id);

    if (!item) {
      throw new ApiError(404, 'Menu item not found');
    }

    res.status(200).json({ message: 'Menu item removed' });
  } catch (error) {
    next(error);
  }
}
