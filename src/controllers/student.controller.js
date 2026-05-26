import mongoose from 'mongoose';
import { z } from 'zod';
import Student, { STUDENT_CLASSES } from '../models/Student.js';
import { ApiError } from '../utils/ApiError.js';
import { importStudents } from '../utils/excelImport.js';
import { exportStudents } from '../utils/excelExport.js';
import { buildStudentFinancials } from '../utils/studentFinancials.js';

const createStudentSchema = z.object({
  admissionNumber: z.string().trim().min(1),
  name: z.string().trim().min(2),
  class: z.enum(STUDENT_CLASSES),
  balance: z.coerce.number().finite().default(0),
  dailyLimit: z.number().positive().nullable().optional().default(null),
}).strict();

const updateStudentSchema = z.object({
  name: z.string().trim().min(2).optional(),
  class: z.enum(STUDENT_CLASSES).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});

const lookupSchema = z.object({
  admNo: z.string().trim().min(1),
});

const importSchema = z.object({
  rows: z.array(z.unknown()).min(1),
});

const studentIdSchema = z.object({
  id: z.string().min(1),
});

const classFilterSchema = z.object({
  class: z.enum(STUDENT_CLASSES).optional(),
});

function normalizeStudentPayload(payload) {
  const financials = buildStudentFinancials(payload.balance);
  return {
    admissionNumber: payload.admissionNumber.toUpperCase(),
    name: payload.name,
    class: payload.class,
    ...financials,
    history: [],
  };
}

export async function getStudents(req, res, next) {
  try {
    const parsed = classFilterSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, 'Validation failed', parsed.error.flatten());
    }

    const filter = {};
    if (parsed.data.class) {
      filter.class = parsed.data.class;
    }

    const students = await Student.find(filter)
      .select('-history')
      .sort({ class: 1, admissionNumber: 1 })
      .lean();

    res.status(200).json(students);
  } catch (error) {
    next(error);
  }
}

export async function lookupStudent(req, res, next) {
  try {
    const parsed = lookupSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, 'Validation failed', parsed.error.flatten());
    }

    const admissionNumber = parsed.data.admNo.toUpperCase();
    const student = await Student.findOne({ admissionNumber });

    if (!student) {
      throw new ApiError(404, 'No student found with that admission number');
    }

    // compute today's spend
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const todaySpent = student.history
      .filter((tx) => new Date(tx.date) >= startOfDay)
      .reduce((s, tx) => s + (tx.total || 0), 0);

    res.status(200).json({ ...student.toObject(), todaySpent });
  } catch (error) {
    next(error);
  }
}

const rechargeSchema = z.object({
  amount: z.coerce.number().finite().positive(),
  note: z.string().max(200).optional().default(''),
}).strict();

const bulkRechargeRowSchema = z.object({
  'Admission No': z.string().min(1),
  'Amount': z.coerce.number().finite().positive(),
  'Note': z.string().max(200).optional().default(''),
});

export async function rechargeStudent(req, res, next) {
  try {
    const paramsResult = studentIdSchema.safeParse(req.params);
    if (!paramsResult.success) throw new ApiError(400, 'Validation failed', paramsResult.error.flatten());

    const parsed = rechargeSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());

    if (!mongoose.Types.ObjectId.isValid(paramsResult.data.id)) {
      throw new ApiError(400, 'Invalid student id');
    }

    const student = await Student.findById(paramsResult.data.id);
    if (!student) throw new ApiError(404, 'Student not found');

    student.balance += parsed.data.amount;
    student.totalCredit += parsed.data.amount;
    student.rechargeHistory.push({ amount: parsed.data.amount, note: parsed.data.note, date: new Date() });

    await student.save();

    res.status(200).json({ message: 'Balance recharged', newBalance: student.balance, totalCredit: student.totalCredit });
  } catch (err) {
    next(err);
  }
}

export async function bulkRecharge(req, res, next) {
  try {
    const parsed = z.array(bulkRechargeRowSchema).safeParse(req.body.rows);
    if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());

    const rows = parsed.data;
    let recharged = 0;
    let notFound = 0;

    // small batches: iterate; for large use bulkWrite (suggested in docs)
    for (const row of rows) {
      const adm = String(row['Admission No']).toUpperCase();
      const student = await Student.findOne({ admissionNumber: adm });
      if (!student) { notFound++; continue; }
      student.balance += row['Amount'];
      student.totalCredit += row['Amount'];
      student.rechargeHistory.push({ amount: row['Amount'], note: row['Note'] ?? '', date: new Date() });
      await student.save();
      recharged++;
    }

    res.status(200).json({ message: 'Bulk recharge complete', recharged, notFound, total: rows.length });
  } catch (err) {
    next(err);
  }
}

export async function getDebtors(req, res, next) {
  try {
    const pipeline = [
      { $match: { balance: { $lt: 0 } } },
      { $sort: { class: 1, balance: 1 } },
      { $group: {
        _id: '$class',
        classTotal: { $sum: '$balance' },
        students: { $push: { admissionNumber: '$admissionNumber', name: '$name', balance: '$balance' } }
      }},
      { $project: { _id: 0, class: '$_id', classTotal: 1, students: 1 } },
      { $sort: { class: 1 } },
    ];

    const data = await Student.aggregate(pipeline);
    res.status(200).json(data);
  } catch (err) { next(err); }
}

export async function createStudent(req, res, next) {
  try {
    const parsed = createStudentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'Validation failed', parsed.error.flatten());
    }

    const student = await Student.create(normalizeStudentPayload(parsed.data));

    res.status(201).json(student);
  } catch (error) {
    if (error?.code === 11000) {
      return next(new ApiError(409, 'Admission number already exists'));
    }

    next(error);
  }
}

export async function updateStudent(req, res, next) {
  try {
    const paramsResult = studentIdSchema.safeParse(req.params);
    if (!paramsResult.success) {
      throw new ApiError(400, 'Validation failed', paramsResult.error.flatten());
    }

    if (!mongoose.Types.ObjectId.isValid(paramsResult.data.id)) {
      throw new ApiError(400, 'Invalid student id');
    }

    const bodyResult = updateStudentSchema.safeParse(req.body);
    if (!bodyResult.success) {
      throw new ApiError(400, 'Validation failed', bodyResult.error.flatten());
    }

    const student = await Student.findByIdAndUpdate(
      paramsResult.data.id,
      { $set: bodyResult.data },
      { new: true, runValidators: true },
    );

    if (!student) {
      throw new ApiError(404, 'Student not found');
    }

    res.status(200).json(student);
  } catch (error) {
    next(error);
  }
}

export async function deleteStudent(req, res, next) {
  try {
    const paramsResult = studentIdSchema.safeParse(req.params);
    if (!paramsResult.success) {
      throw new ApiError(400, 'Validation failed', paramsResult.error.flatten());
    }

    if (!mongoose.Types.ObjectId.isValid(paramsResult.data.id)) {
      throw new ApiError(400, 'Invalid student id');
    }

    const student = await Student.findByIdAndDelete(paramsResult.data.id);

    if (!student) {
      throw new ApiError(404, 'Student not found');
    }

    res.status(200).json({ message: 'Student deleted successfully' });
  } catch (error) {
    next(error);
  }
}

export async function importStudentRows(req, res, next) {
  try {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'Validation failed', parsed.error.flatten());
    }

    const result = await importStudents(parsed.data.rows);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function exportStudentRows(req, res, next) {
  try {
    await exportStudents(res);
  } catch (error) {
    next(error);
  }
}
