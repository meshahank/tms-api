import { z } from 'zod';
import Student, { STUDENT_CLASSES } from '../models/Student.js';
import { ApiError } from './ApiError.js';
import { buildStudentFinancials } from './studentFinancials.js';

const rowSchema = z.object({
  admissionNumber: z.string().trim().min(1),
  name: z.string().trim().min(2),
  class: z.enum(STUDENT_CLASSES),
  balance: z.coerce.number().finite().default(0),
});

function buildImportDocument(student) {
  const financials = buildStudentFinancials(student.balance);

  return {
    admissionNumber: student.admissionNumber.toUpperCase(),
    name: student.name,
    class: student.class,
    ...financials,
    history: [],
  };
}

export async function importStudents(rows) {
  if (!Array.isArray(rows)) {
    throw new ApiError(400, 'Rows must be an array');
  }

  const validRows = [];
  const invalidRows = [];
  const seenAdmissionNumbers = new Set();

  for (const row of rows) {
    const result = rowSchema.safeParse(row);

    if (!result.success) {
      invalidRows.push({ row, errors: result.error.flatten() });
      continue;
    }

    const normalizedAdmissionNumber = result.data.admissionNumber.toUpperCase();
    if (seenAdmissionNumbers.has(normalizedAdmissionNumber)) {
      invalidRows.push({
        row,
        errors: {
          formErrors: ['Duplicate admission number in import payload'],
          fieldErrors: {},
        },
      });
      continue;
    }

    seenAdmissionNumbers.add(normalizedAdmissionNumber);
    validRows.push({
      ...result.data,
      admissionNumber: normalizedAdmissionNumber,
    });
  }

  if (invalidRows.length > 0) {
    throw new ApiError(400, 'Validation errors in import', invalidRows);
  }

  if (validRows.length === 0) {
    return {
      inserted: 0,
      skipped: 0,
      skippedAdmNos: [],
    };
  }

  const admissionNumbers = validRows.map((student) => student.admissionNumber);
  const existingAdmissionNumbers = await Student.find({
    admissionNumber: { $in: admissionNumbers },
  }).distinct('admissionNumber');

  const existingSet = new Set(existingAdmissionNumbers.map((value) => String(value).toUpperCase()));
  const insertableRows = validRows.filter((student) => !existingSet.has(student.admissionNumber));

  if (insertableRows.length === 0) {
    return {
      inserted: 0,
      skipped: validRows.length,
      skippedAdmNos: admissionNumbers,
    };
  }

  const operations = insertableRows.map((student) => ({
    updateOne: {
      filter: { admissionNumber: student.admissionNumber },
      update: { $setOnInsert: buildImportDocument(student) },
      upsert: true,
    },
  }));

  const result = await Student.bulkWrite(operations, { ordered: false });
  const inserted = result.upsertedCount ?? insertableRows.length;
  const skippedAdmNos = validRows
    .filter((student) => existingSet.has(student.admissionNumber))
    .map((student) => student.admissionNumber);

  return {
    inserted,
    skipped: validRows.length - inserted,
    skippedAdmNos,
  };
}
