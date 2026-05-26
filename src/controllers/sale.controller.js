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
      // Enforce dailyLimit if set
      if (student.dailyLimit != null) {
        const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
        const todaySpent = student.history
          .filter((tx) => new Date(tx.date) >= startOfDay)
          .reduce((s, tx) => s + (tx.total || 0), 0);
        if (todaySpent + serverTotal > student.dailyLimit) {
          throw new ApiError(400, `Daily spending limit of ₹${student.dailyLimit} would be exceeded. Already spent ₹${todaySpent} today.`);
        }
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

export async function getDailySummary(req, res, next) {
  try {
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);

    const pipeline = [
      { $unwind: '$history' },
      { $match: { 'history.date': { $gte: startOfDay } } },
      { $group: {
        _id: null,
        totalRevenue: { $sum: '$history.total' },
        transactionCount: { $sum: 1 },
        allItems: { $push: '$history.items' },
      } },
    ];

    const [result] = await Student.aggregate(pipeline);
    if (!result) return res.json({ totalRevenue: 0, transactionCount: 0, topItem: null });

    const itemCounts = {};
    result.allItems.flat().forEach((item) => { itemCounts[item.name] = (itemCounts[item.name] || 0) + 1; });
    const topItem = Object.entries(itemCounts).sort((a,b) => b[1]-a[1])[0]?.[0] ?? null;

    res.status(200).json({ totalRevenue: result.totalRevenue, transactionCount: result.transactionCount, topItem });
  } catch (err) { next(err); }
}

import ExcelJS from 'exceljs';

export async function exportSalesReport(req, res, next) {
  try {
    const from = new Date(req.query.from);
    const to = new Date(req.query.to);
    to.setHours(23,59,59,999);

    if (isNaN(from) || isNaN(to) || from > to) throw new ApiError(400, 'Invalid date range');

    const pipeline = [
      { $unwind: '$history' },
      { $match: { 'history.date': { $gte: from, $lte: to } } },
      { $group: { _id: '$class', spent: { $sum: '$history.total' }, txCount: { $sum: 1 }, items: { $push: '$history.items' } } },
      { $sort: { _id: 1 } },
    ];

    const rows = await Student.aggregate(pipeline);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Teapetti';

    const summarySheet = wb.addWorksheet('Summary');
    summarySheet.columns = [ { header: 'Metric', key: 'metric', width: 28 }, { header: 'Value', key: 'value', width: 18 } ];
    const totalRevenue = rows.reduce((s,r) => s + r.spent, 0);
    const totalTx = rows.reduce((s,r) => s + r.txCount, 0);
    summarySheet.addRows([
      { metric: 'Report Period', value: `${req.query.from} → ${req.query.to}` },
      { metric: 'Total Revenue', value: `₹${totalRevenue}` },
      { metric: 'Total Transactions', value: totalTx },
    ]);

    const classSheet = wb.addWorksheet('Per-Class Spending');
    classSheet.columns = [ { header: 'Class', key: 'class', width: 10 }, { header: 'Total Spent', key: 'spent', width: 14 }, { header: 'Transactions', key: 'txCount', width: 16 } ];
    rows.forEach(r => classSheet.addRow({ class: r._id, spent: r.spent, txCount: r.txCount }));

    const itemSheet = wb.addWorksheet('Item Breakdown');
    itemSheet.columns = [ { header: 'Item', key: 'name', width: 20 }, { header: 'Units Sold', key: 'count', width: 14 }, { header: 'Revenue (₹)', key: 'rev', width: 14 } ];
    const itemMap = {};
    rows.forEach(r => r.items.flat().forEach(item => {
      if (!itemMap[item.name]) itemMap[item.name] = { count: 0, rev: 0 };
      itemMap[item.name].count += 1;
      itemMap[item.name].rev += item.price;
    }));
    Object.entries(itemMap).forEach(([name, v]) => itemSheet.addRow({ name, count: v.count, rev: v.rev }));

    [summarySheet, classSheet, itemSheet].forEach(ws => {
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE07B1A' } };
    });

    const filename = `Teapetti_report_${req.query.from}_to_${req.query.to}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
}

export async function getItemAnalytics(req, res, next) {
  try {
    const range = req.query.range === 'month' ? 30 : 7;
    const since = new Date(); since.setDate(since.getDate() - range); since.setHours(0,0,0,0);

    const pipeline = [
      { $unwind: '$history' },
      { $match: { 'history.date': { $gte: since } } },
      { $unwind: '$history.items' },
      { $group: { _id: { name: '$history.items.name', price: '$history.items.price' }, count: { $sum: 1 } } },
      { $project: { _id: 0, name: { $concat: ['$_id.name', ' (₹', { $toString: '$_id.price' }, ')'] }, count: 1 } },
      { $sort: { count: -1 } },
    ];

    const data = await Student.aggregate(pipeline);
    res.status(200).json(data);
  } catch (err) { next(err); }
}
