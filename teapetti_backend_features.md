# Teapetti — Backend Feature Additions

> New Features · Campus Coffee Shop · College Students Union · v2.0

---

## Table of Contents

1. [Low Balance Alerts](#1-low-balance-alerts)
2. [Daily Sales Summary](#2-daily-sales-summary)
3. [Recharge / Credit System](#3-recharge--credit-system)
4. [Monthly Reports — Excel Export](#4-monthly-reports--excel-export)
5. [Item-wise Sales Analytics](#5-item-wise-sales-analytics)
6. [Student Purchase Limit](#6-student-purchase-limit)
7. [Bulk Recharge via Excel](#7-bulk-recharge-via-excel)
8. [Menu Item Prices](#8-menu-item-prices)
9. [Class-wise Debt View](#9-class-wise-debt-view)
10. [Offline Mode — No Backend Changes](#10-offline-mode--no-backend-changes)

---

## 1. Low Balance Alerts

No new endpoint is required. The existing `GET /students?class=<code>` already returns the `balance` field for every student. The frontend applies the `−₹50` threshold client-side.

**Optional enhancement:** Add a query param to filter directly:

```
GET /students?class=7A&maxBalance=-50
```

```js
// student.controller.js — in getAllStudents():
if (req.query.maxBalance !== undefined) {
  query.balance = { $lte: Number(req.query.maxBalance) }
}
```

This is optional — the current payload size is small enough that client-side filtering works fine.

---

## 2. Daily Sales Summary

### New Route

```
GET /api/sales/summary/today   🔒
```

Returns total revenue, transaction count, and the single most-sold item for the current calendar day.

### Route Registration

```js
// routes/sale.routes.js
import { getDailySummary } from '../controllers/sale.controller.js'

router.get('/summary/today', protect, getDailySummary)
```

> **Important:** Register `/summary/today` **before** any `/:id` pattern routes to avoid Express matching `"summary"` as an ID.

### Controller

```js
// controllers/sale.controller.js
export async function getDailySummary(req, res, next) {
  try {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    // All transactions recorded today live as sub-documents inside Student.history
    const pipeline = [
      { $unwind: '$history' },
      { $match: { 'history.date': { $gte: startOfDay } } },
      {
        $group: {
          _id: null,
          totalRevenue:     { $sum: '$history.total' },
          transactionCount: { $sum: 1 },
          allItems:         { $push: '$history.items' },
        }
      },
    ]

    const [result] = await Student.aggregate(pipeline)

    if (!result) {
      return res.json({ totalRevenue: 0, transactionCount: 0, topItem: null })
    }

    // Flatten nested items array and count by name
    const itemCounts = {}
    result.allItems.flat().forEach(item => {
      itemCounts[item.name] = (itemCounts[item.name] ?? 0) + 1
    })
    const topItem = Object.entries(itemCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    res.json({
      totalRevenue:     result.totalRevenue,
      transactionCount: result.transactionCount,
      topItem,
    })
  } catch (err) {
    next(err)
  }
}
```

**Response `200`:**
```json
{
  "totalRevenue": 480,
  "transactionCount": 34,
  "topItem": "Coffee"
}
```

---

## 3. Recharge / Credit System

### Schema Update — `Student.js`

Add a `rechargeHistory` array to keep a full audit trail of every top-up:

```js
// models/Student.js — add inside studentSchema
const rechargeSchema = new mongoose.Schema({
  date:   { type: Date,   default: Date.now },
  amount: { type: Number, required: true },
  note:   { type: String, default: '' },
}, { _id: true })

// Add field to studentSchema:
rechargeHistory: { type: [rechargeSchema], default: [] },
```

`totalCredit` already exists on the schema — it is incremented on every recharge.

### New Route

```
POST /api/students/:id/recharge   🔒
```

**Request body:**
```json
{
  "amount": 100,
  "note": "June fee collection"
}
```

**Response `200`:**
```json
{
  "message": "Balance recharged",
  "newBalance": -50,
  "totalCredit": 405
}
```

### Route Registration

```js
// routes/student.routes.js
import { rechargeStudent } from '../controllers/student.controller.js'

router.post('/:id/recharge', protect, rechargeStudent)
```

### Controller

```js
// controllers/student.controller.js
import { z } from 'zod'
import { ApiError } from '../utils/ApiError.js'
import Student from '../models/Student.js'

const rechargeSchema = z.object({
  amount: z.number().positive('Amount must be greater than 0'),
  note:   z.string().max(200).optional().default(''),
})

export async function rechargeStudent(req, res, next) {
  try {
    const { amount, note } = rechargeSchema.parse(req.body)

    const student = await Student.findById(req.params.id)
    if (!student) throw new ApiError(404, 'Student not found')

    student.balance      += amount
    student.totalCredit  += amount
    student.rechargeHistory.push({ amount, note })

    await student.save()

    res.json({
      message:     'Balance recharged',
      newBalance:  student.balance,
      totalCredit: student.totalCredit,
    })
  } catch (err) {
    next(err)
  }
}
```

---

## 4. Monthly Reports — Excel Export

### New Route

```
GET /api/sales/report/export?from=YYYY-MM-DD&to=YYYY-MM-DD   🔒
```

Streams a formatted `.xlsx` file with three sheets: **Summary**, **Per-Class Spending**, and **Item Breakdown**.

### Route Registration

```js
// routes/sale.routes.js
import { exportSalesReport } from '../controllers/sale.controller.js'

router.get('/report/export', protect, exportSalesReport)
```

### Controller + ExcelJS Generator

```js
// controllers/sale.controller.js
import ExcelJS from 'exceljs'

export async function exportSalesReport(req, res, next) {
  try {
    const from = new Date(req.query.from)
    const to   = new Date(req.query.to)
    to.setHours(23, 59, 59, 999)

    if (isNaN(from) || isNaN(to) || from > to) {
      throw new ApiError(400, 'Invalid date range')
    }

    // Aggregate all transactions in range
    const pipeline = [
      { $unwind: '$history' },
      { $match: { 'history.date': { $gte: from, $lte: to } } },
      {
        $group: {
          _id:      '$class',
          spent:    { $sum: '$history.total' },
          txCount:  { $sum: 1 },
          items:    { $push: '$history.items' },
        }
      },
      { $sort: { _id: 1 } },
    ]

    const rows = await Student.aggregate(pipeline)

    const wb = new ExcelJS.Workbook()
    wb.creator = 'Teapetti'

    // ── Sheet 1: Summary ────────────────────────────────
    const summarySheet = wb.addWorksheet('Summary')
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 28 },
      { header: 'Value',  key: 'value',  width: 18 },
    ]
    const totalRevenue = rows.reduce((s, r) => s + r.spent, 0)
    const totalTx      = rows.reduce((s, r) => s + r.txCount, 0)
    summarySheet.addRows([
      { metric: 'Report Period',    value: `${req.query.from} → ${req.query.to}` },
      { metric: 'Total Revenue',    value: `₹${totalRevenue}` },
      { metric: 'Total Transactions', value: totalTx },
    ])

    // ── Sheet 2: Per-Class Spending ──────────────────────
    const classSheet = wb.addWorksheet('Per-Class Spending')
    classSheet.columns = [
      { header: 'Class',        key: 'class',   width: 10 },
      { header: 'Total Spent',  key: 'spent',   width: 14 },
      { header: 'Transactions', key: 'txCount', width: 16 },
    ]
    rows.forEach(r => classSheet.addRow({ class: r._id, spent: r.spent, txCount: r.txCount }))

    // ── Sheet 3: Item Breakdown ──────────────────────────
    const itemSheet = wb.addWorksheet('Item Breakdown')
    itemSheet.columns = [
      { header: 'Item',        key: 'name',  width: 20 },
      { header: 'Units Sold',  key: 'count', width: 14 },
      { header: 'Revenue (₹)', key: 'rev',   width: 14 },
    ]
    const itemMap = {}
    rows.forEach(r =>
      r.items.flat().forEach(item => {
        if (!itemMap[item.name]) itemMap[item.name] = { count: 0, rev: 0 }
        itemMap[item.name].count += 1
        itemMap[item.name].rev   += item.price
      })
    )
    Object.entries(itemMap).forEach(([name, v]) =>
      itemSheet.addRow({ name, count: v.count, rev: v.rev })
    )

    // Style all header rows with brand orange
    ;[summarySheet, classSheet, itemSheet].forEach(ws => {
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE07B1A' } }
    })

    const filename = `Teapetti_report_${req.query.from}_to_${req.query.to}.xlsx`
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

    await wb.xlsx.write(res)
    res.end()
  } catch (err) {
    next(err)
  }
}
```

---

## 5. Item-wise Sales Analytics

### New Route

```
GET /api/sales/analytics/items?range=week   🔒
```

| Param | Values | Default |
|---|---|---|
| `range` | `week` · `month` | `week` |

**Response `200`:**
```json
[
  { "name": "Coffee",      "count": 42 },
  { "name": "Snack (₹10)", "count": 31 },
  { "name": "Snack (₹15)", "count": 19 },
  { "name": "Snack (₹5)",  "count": 8  }
]
```

### Route Registration

```js
// routes/sale.routes.js
import { getItemAnalytics } from '../controllers/sale.controller.js'

router.get('/analytics/items', protect, getItemAnalytics)
```

### Controller

```js
// controllers/sale.controller.js
export async function getItemAnalytics(req, res, next) {
  try {
    const range = req.query.range === 'month' ? 30 : 7
    const since = new Date()
    since.setDate(since.getDate() - range)
    since.setHours(0, 0, 0, 0)

    const pipeline = [
      { $unwind: '$history' },
      { $match: { 'history.date': { $gte: since } } },
      { $unwind: '$history.items' },
      {
        $group: {
          _id:   { name: '$history.items.name', price: '$history.items.price' },
          count: { $sum: 1 },
        }
      },
      {
        $project: {
          _id:   0,
          name:  {
            $concat: [
              '$_id.name',
              ' (₹',
              { $toString: '$_id.price' },
              ')',
            ]
          },
          count: 1,
        }
      },
      { $sort: { count: -1 } },
    ]

    const data = await Student.aggregate(pipeline)
    res.json(data)
  } catch (err) {
    next(err)
  }
}
```

---

## 6. Student Purchase Limit

### Schema Update — `Student.js`

```js
// models/Student.js — add to studentSchema
dailyLimit: {
  type:    Number,
  default: null,   // null = no limit enforced
  min:     0,
},
```

### Student Update/Create

The existing `POST /students` and `PUT /students/:id` routes already accept arbitrary body fields validated by Zod. Add `dailyLimit` to the Zod schema:

```js
// In the student Zod schema (student.controller.js or a shared schemas file):
const studentSchema = z.object({
  admissionNumber: z.string().min(1),
  name:            z.string().min(2),
  class:           z.enum(['1A','1B','2A','2B','3','4A','4B','5','6A','6B','7A','7B']),
  balance:         z.coerce.number().default(0),
  dailyLimit:      z.number().positive().nullable().optional().default(null),  // NEW
})
```

### Lookup Response — Include Today's Spend

The `GET /students/lookup?admNo=` endpoint must now also return `todaySpent` so the Sale page can check the limit before submitting:

```js
// controllers/student.controller.js — in lookupStudent():
const student = await Student.findOne({ admissionNumber: req.query.admNo })
if (!student) throw new ApiError(404, 'Student not found')

// Compute today's spend from history
const startOfDay = new Date()
startOfDay.setHours(0, 0, 0, 0)
const todaySpent = student.history
  .filter(tx => new Date(tx.date) >= startOfDay)
  .reduce((s, tx) => s + tx.total, 0)

res.json({ ...student.toObject(), todaySpent })
```

### Sale Validation — Server-side Limit Check

```js
// controllers/sale.controller.js — in createSale(), after total validation:
if (student.dailyLimit != null) {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const todaySpent = student.history
    .filter(tx => new Date(tx.date) >= startOfDay)
    .reduce((s, tx) => s + tx.total, 0)

  if (todaySpent + serverTotal > student.dailyLimit) {
    throw new ApiError(400,
      `Daily spending limit of ₹${student.dailyLimit} would be exceeded. ` +
      `Already spent ₹${todaySpent} today.`
    )
  }
}
```

---

## 7. Bulk Recharge via Excel

### New Route

```
POST /api/students/bulk-recharge   🔒
```

The frontend sends an array of parsed rows from the uploaded Excel file. The backend validates, matches students by admission number, and applies the recharges.

### Route Registration

```js
// routes/student.routes.js
import { bulkRecharge } from '../controllers/student.controller.js'

// Register before /:id routes to avoid collision
router.post('/bulk-recharge', protect, bulkRecharge)
```

### Request Body

```json
{
  "rows": [
    { "Admission No": "3702", "Amount": 100, "Note": "June collection" },
    { "Admission No": "4501", "Amount": 150, "Note": "" }
  ]
}
```

### Controller

```js
// controllers/student.controller.js
const bulkRechargeRowSchema = z.object({
  'Admission No': z.string().min(1),
  'Amount':       z.coerce.number().positive(),
  'Note':         z.string().max(200).optional().default(''),
})

export async function bulkRecharge(req, res, next) {
  try {
    const rows    = z.array(bulkRechargeRowSchema).parse(req.body.rows)
    let recharged = 0
    let notFound  = 0

    for (const row of rows) {
      const student = await Student.findOne({
        admissionNumber: row['Admission No'].toUpperCase()
      })

      if (!student) { notFound++; continue }

      student.balance     += row['Amount']
      student.totalCredit += row['Amount']
      student.rechargeHistory.push({ amount: row['Amount'], note: row['Note'] })
      await student.save()
      recharged++
    }

    res.json({
      message:   'Bulk recharge complete',
      recharged,
      notFound,
      total:     rows.length,
    })
  } catch (err) {
    next(err)
  }
}
```

**Response `200`:**
```json
{
  "message": "Bulk recharge complete",
  "recharged": 47,
  "notFound": 2,
  "total": 49
}
```

> For large batches (200+ students), replace the `for` loop with a `bulkWrite` using `$inc` on `balance` and `totalCredit`, and `$push` on `rechargeHistory`, to reduce round-trips.

---

## 8. Menu Item Prices

### Schema Update — `MenuItem.js`

```js
// models/MenuItem.js
const menuItemSchema = new mongoose.Schema({
  name: {
    type:     String,
    required: true,
    trim:     true,
  },
  image: {
    type:     String,
    required: true,
  },
  price: {
    type:     Number,
    required: true,
    min:      0,
  },
  isActive: {
    type:    Boolean,
    default: false,
  },
}, { timestamps: true })
```

### Updated POST `/menu` Request Body

```json
{
  "name": "Masala Tea",
  "image": "https://...",
  "price": 10,
  "isActive": false
}
```

### Zod Validation Update

```js
// In menu.controller.js — createMenuItem Zod schema:
const menuItemSchema = z.object({
  name:     z.string().min(1),
  image:    z.string().url(),
  price:    z.number().positive(),          // NEW — required
  isActive: z.boolean().optional().default(false),
})
```

### Response Shape — `GET /menu`

```json
[
  {
    "_id": "...",
    "name": "Coffee",
    "image": "https://...",
    "price": 10,
    "isActive": true
  }
]
```

No other endpoint changes are required. The `price` field is now returned automatically with every menu document.

---

## 9. Class-wise Debt View

### New Route

```
GET /api/students/debtors   🔒
```

Returns all students with a negative balance, grouped by class, with the class-level debt total, sorted by class code.

### Route Registration

```js
// routes/student.routes.js
import { getDebtors } from '../controllers/student.controller.js'

// Register before /:id
router.get('/debtors', protect, getDebtors)
```

### Controller

```js
// controllers/student.controller.js
export async function getDebtors(req, res, next) {
  try {
    const pipeline = [
      // Only students with a negative balance
      { $match: { balance: { $lt: 0 } } },

      // Sort: class alphabetically, then worst debt first within class
      { $sort: { class: 1, balance: 1 } },

      // Group by class
      {
        $group: {
          _id:        '$class',
          classTotal: { $sum: '$balance' },
          students:   {
            $push: {
              admissionNumber: '$admissionNumber',
              name:            '$name',
              balance:         '$balance',
            }
          },
        }
      },

      // Reshape output
      {
        $project: {
          _id:        0,
          class:      '$_id',
          classTotal: 1,
          students:   1,
        }
      },

      { $sort: { class: 1 } },
    ]

    const data = await Student.aggregate(pipeline)
    res.json(data)
  } catch (err) {
    next(err)
  }
}
```

**Response `200`:**
```json
[
  {
    "class": "6B",
    "classTotal": -350,
    "students": [
      { "admissionNumber": "4201", "name": "Student A", "balance": -200 },
      { "admissionNumber": "4205", "name": "Student B", "balance": -150 }
    ]
  },
  {
    "class": "7A",
    "classTotal": -80,
    "students": [
      { "admissionNumber": "3702", "name": "Student C", "balance": -80 }
    ]
  }
]
```

---

## 10. Offline Mode — No Backend Changes

Offline mode is implemented entirely on the frontend via a Service Worker (see Frontend doc). The backend requires no modifications.

When the device reconnects, the frontend retries any queued sale POSTes against the standard `POST /api/sales` endpoint — the server handles them identically to online requests.

---

## Updated Project Structure

The additions introduce the following new files and changes:

```
src/
├── models/
│   ├── Student.js          ← schema: +rechargeHistory, +dailyLimit
│   └── MenuItem.js         ← schema: +price (required)
│
├── routes/
│   ├── student.routes.js   ← +POST /:id/recharge, +POST /bulk-recharge, +GET /debtors
│   └── sale.routes.js      ← +GET /summary/today, +GET /report/export, +GET /analytics/items
│
├── controllers/
│   ├── student.controller.js  ← +rechargeStudent, +bulkRecharge, +getDebtors
│   │                             updated: lookupStudent (todaySpent), createSale (limit check)
│   └── sale.controller.js     ← +getDailySummary, +exportSalesReport, +getItemAnalytics
│
└── utils/
    └── excelExport.js      ← new exportSalesReport helper (or inline in controller)
```

## New API Endpoints Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/sales/summary/today` | 🔒 | Daily revenue, count, top item |
| `GET` | `/sales/report/export` | 🔒 | Excel report for date range |
| `GET` | `/sales/analytics/items` | 🔒 | Item counts for week/month |
| `POST` | `/students/:id/recharge` | 🔒 | Top up a student's balance |
| `POST` | `/students/bulk-recharge` | 🔒 | Recharge many students from Excel |
| `GET` | `/students/debtors` | 🔒 | All negative-balance students, grouped by class |

All other features (low balance alerts, purchase limits, menu prices, offline mode) are handled through **schema updates to existing models** and **changes to existing endpoint logic** rather than new routes.

---

> **Teapetti Backend Features** · Node.js 20 · Express · MongoDB · JWT
