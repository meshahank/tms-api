import mongoose from 'mongoose';
import { z } from 'zod';
import Student from '../models/Student.js';
import { ApiError } from '../utils/ApiError.js';

const allowedPrices = [5, 10, 15];

const saleItemSchema = z.object({
  name: z.string().trim().min(1),
  price: z.coerce.number().finite().refine((value) => allowedPrices.includes(value), {
    message: `Price must be one of ${allowedPrices.join(', ')}`,
  }),
});

const saleSchema = z.object({
  studentId: z.string().trim().min(1),
  items: z.array(saleItemSchema).min(1),
  total: z.coerce.number().finite().nonnegative(),
}).strict();

export async function createSale(req, res, next) {
  const session = await mongoose.startSession();

  try {
    const parsed = saleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'Validation failed', parsed.error.flatten());
    }

    const { studentId, items, total } = parsed.data;
    const serverTotal = items.reduce((sum, item) => sum + item.price, 0);

    if (serverTotal !== total) {
      throw new ApiError(400, `Total mismatch: expected ${serverTotal}, got ${total}`);
    }

    let transaction = null;
    let newBalance = null;

    await session.withTransaction(async () => {
      const student = await Student.findOne({ admissionNumber: studentId.toUpperCase() }).session(session);

      if (!student) {
        throw new ApiError(404, 'Student not found');
      }

      student.balance -= total;
      student.totalSpent += total;
      student.history.push({
        date: new Date(),
        items,
        total,
      });

      await student.save({ session });

      newBalance = student.balance;
      transaction = student.history[student.history.length - 1].toObject();
    });

    res.status(201).json({
      message: 'Sale recorded successfully',
      newBalance,
      transaction,
    });
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
}
