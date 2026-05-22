# Teapetti — Backend Documentation

> Campus Coffee Shop · College Students Union · v1.0

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
8. [Excel Import/Export](#8-excel-importexport)
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
│   │   ├── Student.js
│   │   ├── MenuItem.js
│   │   └── Admin.js
│   │
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── student.routes.js
│   │   ├── sale.routes.js
│   │   └── menu.routes.js
│   │
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── student.controller.js
│   │   ├── sale.controller.js
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
│
├── .env
├── .env.example
├── package.json
└── server.js                  # Entry point
```

---

## 3. Database Schema

### 3.1 Student Model (`models/Student.js`)

```js
import mongoose from 'mongoose'

const saleItemSchema = new mongoose.Schema({
  name:  { type: String, required: true },   // 'Coffee' | 'Snack'
  price: { type: Number, required: true },   // 10 | 15 | 5
}, { _id: false })

const transactionSchema = new mongoose.Schema({
  date:  { type: Date, default: Date.now },
  items: [saleItemSchema],
  total: { type: Number, required: true },
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
    // Can go negative — credit-based system
  },
  totalCredit: { type: Number, default: 0 },
  totalSpent:  { type: Number, default: 0 },
  history: [transactionSchema],
}, {
  timestamps: true,
})

// Virtual: recompute balance on the fly (optional — balance is also stored directly)
studentSchema.virtual('computedBalance').get(function () {
  return this.totalCredit - this.totalSpent
})

export default mongoose.model('Student', studentSchema)
```

### 3.2 MenuItem Model (`models/MenuItem.js`)

```js
import mongoose from 'mongoose'

const menuItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  image: {
    type: String,  // URL or path to image
    required: true,
  },
  isActive: {
    type: Boolean,
    default: false,  // Admin must explicitly activate an item
  },
}, {
  timestamps: true,
})

export default mongoose.model('MenuItem', menuItemSchema)
```

### 3.3 Admin Model (`models/Admin.js`)

```js
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },   // bcrypt hash
}, { timestamps: true })

// Hash password before save
adminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

// Compare plain password against hash
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

#### `POST /auth/login`

Login as admin.

**Request body:**
```json
{
  "username": "admin",
  "password": "secret123"
}
```

**Response `200`:**
```json
{
  "token": "eyJhbGc...",
  "admin": { "username": "admin" }
}
```

**Response `401`:**
```json
{ "error": "Invalid credentials" }
```

---

#### `POST /auth/logout`

🔒 Protected. Stateless JWT — client discards the token. Server can optionally maintain a token blocklist.

**Response `200`:**
```json
{ "message": "Logged out successfully" }
```

---

### 6.2 Student Routes

#### `GET /students` 🔒

Returns all students. Supports optional class filter.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `class` | String | Filter by class code, e.g. `?class=7A` |

**Response `200`:**
```json
[
  {
    "_id": "...",
    "admissionNumber": "3702",
    "name": "Student Name",
    "class": "7A",
    "balance": -200,
    "totalCredit": 305,
    "totalSpent": 505
  }
]
```

---

#### `GET /students/lookup` — **Public**

Lookup a single student by admission number (used on the user Students page).

**Query params:**

| Param | Type | Description |
|---|---|---|
| `admNo` | String | Admission number (required) |

**Response `200`:**
```json
{
  "_id": "...",
  "admissionNumber": "3702",
  "name": "Student Name",
  "class": "8A",
  "balance": -200,
  "totalCredit": 305,
  "totalSpent": 505,
  "history": [
    {
      "_id": "...",
      "date": "2024-11-12T00:00:00.000Z",
      "items": [
        { "name": "Coffee", "price": 10 },
        { "name": "Snack",  "price": 15 }
      ],
      "total": 25
    }
  ]
}
```

**Response `404`:**
```json
{ "error": "No student found with that admission number" }
```

---

#### `POST /students` 🔒

Create a new student.

**Request body:**
```json
{
  "admissionNumber": "4001",
  "name": "New Student",
  "class": "4B",
  "balance": 0
}
```

**Validation rules (Zod):**
- `admissionNumber`: required, non-empty string, unique
- `name`: required, min 2 chars
- `class`: must be one of the 12 valid class codes
- `balance`: optional number, defaults to 0

**Response `201`:** created student object  
**Response `409`:** `{ "error": "Admission number already exists" }`

---

#### `PUT /students/:id` 🔒

Update a student's details (name, class). Balance is managed by the sale system and is **not** directly editable here.

**Request body:**
```json
{
  "name": "Updated Name",
  "class": "5"
}
```

**Response `200`:** updated student object

---

#### `DELETE /students/:id` 🔒

Permanently delete a student and all their history.

**Response `200`:**
```json
{ "message": "Student deleted successfully" }
```

---

#### `POST /students/import` 🔒

Bulk import students from a parsed Excel file.

**Request body:**
```json
{
  "rows": [
    { "admissionNumber": "4001", "name": "Student A", "class": "4A", "balance": 0 },
    { "admissionNumber": "4002", "name": "Student B", "class": "4A", "balance": 50 }
  ]
}
```

**Behaviour:**
- Validates every row using the same Zod schema as `POST /students`
- Uses MongoDB `bulkWrite` with `upsert: false` to skip existing admission numbers
- Returns a summary of inserted vs skipped

**Response `200`:**
```json
{
  "inserted": 18,
  "skipped":  2,
  "skippedAdmNos": ["3001", "3002"]
}
```

---

#### `GET /students/export` 🔒

Returns all student data as a downloadable `.xlsx` file.

**Response:** Binary `.xlsx` file stream  
**Headers:**
```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="Teapetti_students.xlsx"
```

---

### 6.3 Sale Routes

#### `POST /sales` 🔒

Record a completed sale. Deducts total from student balance and appends to history.

**Request body:**
```json
{
  "studentId": "3702",
  "items": [
    { "name": "Coffee", "price": 10 },
    { "name": "Snack",  "price": 15 }
  ],
  "total": 25
}
```

**Validation:**
- `studentId`: must match an existing `admissionNumber`
- `items`: array, min 1 item
- Each item: `name` (string), `price` (number, must be 5 | 10 | 15)
- `total`: must equal the sum of all item prices (server re-validates)

**Behaviour (atomic):**
```js
// Inside a Mongoose session / transaction:
student.balance    -= total
student.totalSpent += total
student.history.push({ date: new Date(), items, total })
await student.save()
```

**Response `201`:**
```json
{
  "message": "Sale recorded successfully",
  "newBalance": -200,
  "transaction": {
    "_id": "...",
    "date": "2024-11-20T10:30:00.000Z",
    "items": [...],
    "total": 25
  }
}
```

**Response `400`:**
```json
{ "error": "Total mismatch: expected 25, got 20" }
```

**Response `404`:**
```json
{ "error": "Student not found" }
```

---

### 6.4 Menu Routes

#### `GET /menu` — **Public**

Returns all menu items. Supports `isActive` filter.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `active` | Boolean | `?active=true` returns only active items (used by user portal) |

**Response `200`:**
```json
[
  {
    "_id": "...",
    "name": "Filter Coffee",
    "image": "https://...",
    "isActive": true
  }
]
```

---

#### `PATCH /menu/:id` 🔒

Toggle a menu item's active status.

**Request body:**
```json
{ "isActive": true }
```

**Response `200`:** updated menu item object

---

#### `POST /menu` 🔒

Add a new menu item to the pool.

**Request body:**
```json
{
  "name": "Masala Tea",
  "image": "https://...",
  "isActive": false
}
```

**Response `201`:** created menu item

---

#### `DELETE /menu/:id` 🔒

Remove a menu item permanently.

**Response `200`:**
```json
{ "message": "Menu item removed" }
```

---

## 7. Business Logic

### 7.1 Balance System

The shop operates on a **credit system** — students may have a pre-loaded balance or run a tab.

```
balance = totalCredit − totalSpent
```

- Negative balance is **allowed** — the student owes money
- Balance is stored directly on the student document for fast reads
- `totalCredit` and `totalSpent` are stored for full audit trail
- The sale endpoint is the **only** way to modify `balance` and `totalSpent`

### 7.2 Sale Validation (server-side)

Even though the frontend sends a `total`, the server **recomputes and validates** it:

```js
const serverTotal = items.reduce((sum, item) => sum + item.price, 0)
if (serverTotal !== body.total) {
  throw new ApiError(400, `Total mismatch: expected ${serverTotal}, got ${body.total}`)
}

const allowedPrices = [5, 10, 15]
for (const item of items) {
  if (!allowedPrices.includes(item.price)) {
    throw new ApiError(400, `Invalid price: ${item.price}`)
  }
}
```

### 7.3 Class Codes

Valid class codes are enforced at the model level:

```js
enum: ['1A','1B','2A','2B','3','4A','4B','5','6A','6B','7A','7B']
```

Any attempt to set an invalid class (via API or import) is rejected with a `400`.

### 7.4 Menu Active State

- Only items with `isActive: true` are returned by `GET /menu?active=true`
- The admin's Menu Management page fetches all items and splits them client-side (or the API can split them using query params)
- There is no limit on how many items can be active simultaneously

---

## 8. Excel Import/Export

### 8.1 Import (`utils/excelImport.js`)

Called by `POST /students/import`. The frontend sends parsed JSON rows; the backend validates and bulk inserts.

```js
import Student from '../models/Student.js'
import { ApiError } from './ApiError.js'
import { z } from 'zod'

const rowSchema = z.object({
  admissionNumber: z.string().min(1),
  name:            z.string().min(2),
  class:           z.enum(['1A','1B','2A','2B','3','4A','4B','5','6A','6B','7A','7B']),
  balance:         z.coerce.number().default(0),
})

export async function importStudents(rows) {
  const valid   = []
  const invalid = []

  for (const row of rows) {
    const result = rowSchema.safeParse(row)
    if (result.success) valid.push(result.data)
    else invalid.push({ row, errors: result.error.flatten() })
  }

  if (invalid.length) {
    throw new ApiError(400, 'Validation errors in import', invalid)
  }

  const ops = valid.map(s => ({
    updateOne: {
      filter: { admissionNumber: s.admissionNumber },
      update: { $setOnInsert: s },
      upsert: true,
    }
  }))

  const result = await Student.bulkWrite(ops, { ordered: false })
  return {
    inserted: result.upsertedCount,
    skipped:  result.matchedCount,
  }
}
```

### 8.2 Export (`utils/excelExport.js`)

Called by `GET /students/export`. Streams an `.xlsx` file to the response.

```js
import ExcelJS from 'exceljs'
import Student from '../models/Student.js'

export async function exportStudents(res) {
  const students = await Student.find().sort({ class: 1, admissionNumber: 1 })

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Students')

  ws.columns = [
    { header: 'Admission No', key: 'admissionNumber', width: 16 },
    { header: 'Name',         key: 'name',            width: 28 },
    { header: 'Class',        key: 'class',           width: 10 },
    { header: 'Balance (₹)', key: 'balance',          width: 14 },
    { header: 'Total Credit', key: 'totalCredit',     width: 14 },
    { header: 'Total Spent',  key: 'totalSpent',      width: 14 },
  ]

  // Style header row
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid',
                         fgColor: { argb: 'FFE07B1A' } }

  students.forEach(s => ws.addRow({
    admissionNumber: s.admissionNumber,
    name:            s.name,
    class:           s.class,
    balance:         s.balance,
    totalCredit:     s.totalCredit,
    totalSpent:      s.totalSpent,
  }))

  // Highlight negative balances in red
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const balanceCell = row.getCell('balance')
    if (balanceCell.value < 0) {
      balanceCell.font = { color: { argb: 'FFE53935' }, bold: true }
    }
  })

  res.setHeader('Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition',
    'attachment; filename="Teapetti_students.xlsx"')

  await wb.xlsx.write(res)
  res.end()
}
```

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
    return res.status(err.statusCode).json({
      error:   err.message,
      details: err.details ?? undefined,
    })
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error:   'Validation failed',
      details: Object.values(err.errors).map(e => e.message),
    })
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0]
    return res.status(409).json({
      error: `${field} already exists`,
    })
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
| `400` | Bad Request | Validation failure, total mismatch |
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

// Global error handler (see Section 9)
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
