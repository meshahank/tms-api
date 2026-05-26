# Teapetti — Backend Documentation

> Campus Coffee Shop · College Students Union · v2.0

---

## Table of Contents

1. [Tech Stack](#1-tech-stack)
2. [Project Structure](#2-project-structure)
3. [Database Schema](#3-database-schema)
4. [Environment Variables](#4-environment-variables)
5. [Authentication](#5-authentication)
6. [API Reference](#6-api-reference)
   - [Auth](#61-auth-routes)
   - [Students](#62-student-routes)
   - [Sales](#63-sale-routes)
   - [Menu](#64-menu-routes)
7. [Business Logic](#7-business-logic)
8. [Excel Import/Export & Reports](#8-excel-importexport--reports)
9. [Error Handling](#9-error-handling)
10. [Scripts & Setup](#10-scripts--setup)

---

## 1. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | **Node.js 20** | Non-blocking I/O, JSON native |
| Framework | **Express.js** | Minimal, well-understood, easy middleware |
| Database | **MongoDB** with **Mongoose** | Flexible schema, great for document-style student records with nested history arrays |
| Auth | **JWT (jsonwebtoken)** | Stateless, simple for a single-admin setup |
| Password | **bcryptjs** | Secure password hashing |
| Excel | **exceljs** | Read/write `.xlsx` on the server |
| Validation | **Zod** | Schema validation for request bodies |
| Env | **dotenv** | Environment variable management |
| Dev | **nodemon** | Auto-restart on file changes |

---

## 2. Project Structure

```
Teapetti-backend/
├── src/
│   ├── config/
│   │   └── db.js              # MongoDB connection
│   │
│   ├── models/
│   │   ├── Student.js         # +rechargeHistory, +dailyLimit
│   │   ├── MenuItem.js        # +price
│   │   └── Admin.js
│   │
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── student.routes.js  # +recharge, +bulk-recharge, +debtors
│   │   ├── sale.routes.js     # +summary, +report/export, +analytics
│   │   └── menu.routes.js
│   │
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── student.controller.js  # updated: recharge, bulkRecharge, getDebtors, lookup adds todaySpent
│   │   ├── sale.controller.js     # new: getDailySummary, exportSalesReport, getItemAnalytics
│   │   └── menu.controller.js
│   │
│   ├── middleware/
│   │   ├── auth.middleware.js  # JWT verify
│   │   └── validate.js        # Zod request validator
│   │
│   ├── utils/
│   │   ├── excelImport.js
│   │   ├── excelExport.js
│   │   └── ApiError.js
│   │
│   └── app.js                 # Express app setup
|
├── .env
├── .env.example
├── package.json
└── server.js                  # Entry point
```

Notes:
- Several feature additions in v2.0 require small schema changes and new controller routes — see the Database Schema and API Reference sections.

---

## 3. Database Schema

### 3.1 Student Model (`models/Student.js`)

The `Student` model keeps an audit trail of purchases and recharges. New in v2.0:
- `rechargeHistory` (array) — records top-ups with date, amount, note
- `dailyLimit` (Number | null) — optional per-student daily spending cap

```js
import mongoose from 'mongoose'

const saleItemSchema = new mongoose.Schema({
  name:  { type: String, required: true },
  price: { type: Number, required: true },
}, { _id: false })

const transactionSchema = new mongoose.Schema({
  date:  { type: Date, default: Date.now },
  items: [saleItemSchema],
  total: { type: Number, required: true },
}, { _id: true })

const rechargeSchema = new mongoose.Schema({
  date:   { type: Date,   default: Date.now },
  amount: { type: Number, required: true },
  note:   { type: String, default: '' },
}, { _id: true })

const studentSchema = new mongoose.Schema({
  admissionNumber: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  class: {
    type: String,
    required: true,
    enum: ['1A','1B','2A','2B','3','4A','4B','5','6A','6B','7A','7B'],
  },
  balance: {
    type: Number,
    default: 0,
  },
  totalCredit: { type: Number, default: 0 },
  totalSpent:  { type: Number, default: 0 },
  history: [transactionSchema],
  rechargeHistory: { type: [rechargeSchema], default: [] },
  dailyLimit: { type: Number, default: null },
}, {
  timestamps: true,
})

studentSchema.virtual('computedBalance').get(function () {
  return this.totalCredit - this.totalSpent
})

export default mongoose.model('Student', studentSchema)
```

### 3.2 MenuItem Model (`models/MenuItem.js`)

In v2.0 `MenuItem` now includes a required `price` field.

```js
import mongoose from 'mongoose'

const menuItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  image: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
})

export default mongoose.model('MenuItem', menuItemSchema)
```

### 3.3 Admin Model (`models/Admin.js`)

Unchanged from v1.0: bcrypt-hashed password and helper `checkPassword()` method.

```js
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
}, { timestamps: true })

adminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

adminSchema.methods.checkPassword = function (plain) {
  return bcrypt.compare(plain, this.password)
}

export default mongoose.model('Admin', adminSchema)
```

---

## 4. Environment Variables

```bash
# .env.example

# Server
PORT=5000
NODE_ENV=development

# Database
MONGO_URI=mongodb://localhost:27017/Teapetti

# Auth
JWT_SECRET=your_very_long_random_secret_here
JWT_EXPIRES_IN=7d

# CORS — frontend origin
CLIENT_URL=http://localhost:5173
```

---

## 5. Authentication

### Strategy: JWT Bearer Token

- Only the **admin portal** requires authentication.
- All user-facing routes (`GET /students/lookup`, `GET /classes`, `GET /menu`) are **public**.
- Admin routes are protected by the `authMiddleware`.

### `middleware/auth.middleware.js`

```js
import jwt from 'jsonwebtoken'
import { ApiError } from '../utils/ApiError.js'

export function protect(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw new ApiError(401, 'Not authenticated')
  }

  const token = header.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.admin = decoded
    next()
  } catch {
    throw new ApiError(401, 'Token invalid or expired')
  }
}
```

### Login Flow

```
POST /api/auth/login
  → validate username + password
  → find Admin by username
  → bcrypt.compare(password, hash)
  → sign JWT { id, username } expires in JWT_EXPIRES_IN
  → return { token, admin: { username } }
```

---

## 6. API Reference

**Base URL:** `http://localhost:5000/api`  
**Auth header (admin routes):** `Authorization: Bearer <token>`

---

### 6.1 Auth Routes

See v1.0 — `POST /auth/login` and `POST /auth/logout` remain the same.

---

### 6.2 Student Routes

New v2.0 additions: `POST /students/:id/recharge`, `POST /students/bulk-recharge`, `GET /students/debtors`; `GET /students/lookup` now returns `todaySpent`.

#### `GET /students` 🔒

Returns all students. Supports optional class filter and optional balance filters (e.g., `?maxBalance=-50`).

Query params: `class`, optional `maxBalance`.

#### `GET /students/lookup` — **Public**

Now includes `todaySpent` (computed from `history`), useful for enforcing `dailyLimit` client-side.

Response shape adds `todaySpent` to the student object.

#### `POST /students` 🔒

Create a new student. Zod schema should include `dailyLimit` (optional).

#### `PUT /students/:id` 🔒

Unchanged: used to update name/class/dailyLimit. Balance managed only via sales/recharge routes.

#### `POST /students/:id/recharge` 🔒

Top up a student's balance.

Request body:
```json
{
  "amount": 100,
  "note": "June fee collection"
}
```

Behaviour:
- Validate amount > 0
- Find student by id
- Increment `balance` and `totalCredit`
- Push `{ amount, note }` to `rechargeHistory`

Response `200`:
```json
{
  "message": "Balance recharged",
  "newBalance": -50,
  "totalCredit": 405
}
```

#### `POST /students/bulk-recharge` 🔒

Accepts an array of parsed Excel rows. Validates rows, finds students by `admissionNumber` and applies recharges. For large batches, use `bulkWrite`.

Request body example:
```json
{
  "rows": [
    { "Admission No": "3702", "Amount": 100, "Note": "June collection" }
  ]
}
```

Response `200` summarizes `recharged`, `notFound`, and `total`.

#### `GET /students/debtors` 🔒

Returns students with negative balances grouped by class, sorted by class code. Useful for admin debt views and export.

---

### 6.3 Sale Routes

New v2.0 additions: `GET /sales/summary/today`, `GET /sales/report/export`, `GET /sales/analytics/items`.

#### `POST /sales` 🔒

Unchanged in core behaviour, but now includes server-side `dailyLimit` checks:
- After validating the `total`, if `student.dailyLimit != null` compute `todaySpent` from `history` and reject if `todaySpent + serverTotal > dailyLimit`.

#### `GET /sales/summary/today` 🔒

Returns `totalRevenue`, `transactionCount`, and `topItem` for the current calendar day. Implemented by aggregating `Student.history` documents.

#### `GET /sales/report/export?from=YYYY-MM-DD&to=YYYY-MM-DD` 🔒

Streams an `.xlsx` report with multiple sheets: **Summary**, **Per-Class Spending**, and **Item Breakdown**. Validates date range and aggregates transactions in the range.

#### `GET /sales/analytics/items?range=week|month` 🔒

Returns item-wise counts and revenue for the requested range (default week).

---

### 6.4 Menu Routes

`MenuItem` now returns `price` with each menu item. `POST /menu` requires `price` in the body and the `GET /menu` response includes `price`.

The `PATCH /menu/:id` and `DELETE /menu/:id` routes are unchanged in semantics.

---

## 7. Business Logic

### 7.1 Balance System

balance = totalCredit − totalSpent

- Negative balance is allowed — the student owes money
- Balance is stored directly on the student document for fast reads
- `totalCredit` and `totalSpent` are stored for full audit trail
- The sale endpoint remains the only way to modify `totalSpent`; recharges modify `balance` and `totalCredit` and are recorded in `rechargeHistory`.

### 7.2 Sale Validation (server-side)

Server always recomputes and validates sale totals and item prices. Additionally:
- If `student.dailyLimit` is set, compute `todaySpent` from `history` and reject the sale if it would exceed the limit.

Example validation snippet:

```js
const serverTotal = items.reduce((sum, item) => sum + item.price, 0)
if (serverTotal !== body.total) throw new ApiError(400, `Total mismatch: expected ${serverTotal}, got ${body.total}`)

const allowedPrices = [5, 10, 15]
for (const item of items) {
  if (!allowedPrices.includes(item.price)) throw new ApiError(400, `Invalid price: ${item.price}`)
}

if (student.dailyLimit != null) {
  const startOfDay = new Date(); startOfDay.setHours(0,0,0,0)
  const todaySpent = student.history.filter(tx => new Date(tx.date) >= startOfDay).reduce((s, tx) => s + tx.total, 0)
  if (todaySpent + serverTotal > student.dailyLimit) {
    throw new ApiError(400, `Daily spending limit of ₹${student.dailyLimit} would be exceeded. Already spent ₹${todaySpent} today.`)
  }
}
```

### 7.3 Class Codes

Same enum validation as before.

### 7.4 Menu Prices & Active State

- Items include `price` now and are returned in `GET /menu`.
- `isActive` filtering remains supported.

---

## 8. Excel Import/Export & Reports

This section documents both the existing student import/export and the new sales report export and bulk recharge handling.

### 8.1 Import (`utils/excelImport.js`)

Called by `POST /students/import`. Validates rows with Zod and `bulkWrite` to upsert new students (skip existing by admission number).

Row schema should include `dailyLimit` if provided.

### 8.2 Export Students (`utils/excelExport.js`)

`GET /students/export` streams a students `.xlsx` with balances highlighted; unchanged from v1.0 aside from added columns (e.g., `dailyLimit` if desired).

### 8.3 Sales Report Export (`controllers/sale.controller.js`)

`GET /sales/report/export?from=YYYY-MM-DD&to=YYYY-MM-DD` produces a workbook with:
- Sheet 1: Summary (period, total revenue, total transactions)
- Sheet 2: Per-Class Spending
- Sheet 3: Item Breakdown (units sold, revenue)

Example: uses an aggregation over `Student.history`, builds `ExcelJS` workbook and streams it back.

### 8.4 Bulk Recharge

`POST /students/bulk-recharge` accepts parsed rows with `Admission No`, `Amount`, `Note`. For large batches prefer a `bulkWrite` updating `balance` and `totalCredit` and `$push`ing to `rechargeHistory`.

---

## 9. Error Handling

### `utils/ApiError.js`

```js
export class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message)
    this.statusCode = statusCode
    this.details    = details
  }
}
```

### Global Error Handler (`app.js`)

```js
app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details ?? undefined })
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: 'Validation failed', details: Object.values(err.errors).map(e => e.message) })
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0]
    return res.status(409).json({ error: `${field} already exists` })
  }

  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})
```

### Standard Error Responses

| Status | Meaning | When |
|---|---|---|
| `200` | OK | Successful GET / PATCH |
| `201` | Created | Successful POST |
| `400` | Bad Request | Validation failure, total mismatch, limit exceeded |
| `401` | Unauthorized | Missing or invalid JWT |
| `404` | Not Found | Student / item not found |
| `409` | Conflict | Duplicate admission number |
| `500` | Server Error | Unexpected crash |

---

## 10. Scripts & Setup

### Install

```bash
mkdir Teapetti-backend && cd Teapetti-backend
npm init -y
npm install express mongoose jsonwebtoken bcryptjs zod exceljs dotenv cors
npm install -D nodemon
```

### `package.json`

```json
{
  "type": "module",
  "scripts": {
    "dev":   "nodemon src/server.js",
    "start": "node src/server.js",
    "seed":  "node src/seed.js"
  }
}
```

### `src/app.js`

```js
import express from 'express'
import cors from 'cors'
import { authRoutes }    from './routes/auth.routes.js'
import { studentRoutes } from './routes/student.routes.js'
import { saleRoutes }    from './routes/sale.routes.js'
import { menuRoutes }    from './routes/menu.routes.js'

const app = express()

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }))
app.use(express.json())

app.use('/api/auth',     authRoutes)
app.use('/api/students', studentRoutes)
app.use('/api/sales',    saleRoutes)
app.use('/api/menu',     menuRoutes)

app.use(errorHandler)

export default app
```

### `server.js`

```js
import 'dotenv/config'
import app from './src/app.js'
import { connectDB } from './src/config/db.js'

await connectDB()
app.listen(process.env.PORT ?? 5000, () => {
  console.log(`Teapetti server running on port ${process.env.PORT ?? 5000}`)
})
```

### `src/config/db.js`

```js
import mongoose from 'mongoose'

export async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log('MongoDB connected ✓')
  } catch (err) {
    console.error('MongoDB connection failed:', err.message)
    process.exit(1)
  }
}
```

### Seed Admin

```js
// src/seed.js — run once to create the admin account
import 'dotenv/config'
import mongoose from 'mongoose'
import Admin from './src/models/Admin.js'

await mongoose.connect(process.env.MONGO_URI)

await Admin.create({ username: 'admin', password: 'changeme123' })
console.log('Admin created ✓')

await mongoose.disconnect()
```

```bash
node src/seed.js
```

---

> **Teapetti Backend** · Node.js 20 · Express · MongoDB · JWT