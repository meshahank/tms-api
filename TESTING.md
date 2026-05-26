# Teapetti API Guide — Testing & Endpoints (v2.0)

Base URL: `http://localhost:5000/api`

Authentication: admin routes require `Authorization: Bearer <token>` (JWT). Public routes do not.

Quick notes:
- Use `POST /api/auth/login` to obtain a token for protected routes.
- All request/response bodies are JSON unless noted (the report export streams `.xlsx`).

---

## Auth

POST /api/auth/login
- Body: `{ "username": "admin", "password": "..." }`
- Response: `{ "token": "...", "admin": { "username": "admin" } }`

POST /api/auth/logout
- Protected. Client may simply discard token.

---

## Students

GET /api/students
- Protected. Query params: `class` (optional), `maxBalance` (optional, number)
- Returns a list of students (no `history` by default).

GET /api/students/lookup?admNo=3702
- Public. Returns full student object + `todaySpent` (computed for current day).

POST /api/students
- Protected. Create student.
- Body example:
```
{
  "admissionNumber": "4001",
  "name": "Student Name",
  "class": "4A",
  "balance": 0,
  "dailyLimit": null
}
```

PUT /api/students/:id
- Protected. Update student fields (`name`, `class`, `dailyLimit`).

DELETE /api/students/:id
- Protected. Delete student.

POST /api/students/import
- Protected. Body: `{ "rows": [ ... ] }` — parsed Excel rows. See import schema in code.

GET /api/students/export
- Protected. Streams `.xlsx` of students.

POST /api/students/:id/recharge
- Protected. Recharge a single student.
- Body: `{ "amount": 100, "note": "June collection" }`
- Response: `{ "message": "Balance recharged", "newBalance": <number>, "totalCredit": <number> }`

POST /api/students/bulk-recharge
- Protected. Body: `{ "rows": [ { "Admission No": "3702", "Amount": 100, "Note": "..." }, ... ] }`
- Response summarizes recharged, notFound, total.

GET /api/students/debtors
- Protected. Returns classes with negative-balance students grouped and totals.

---

## Sales

POST /api/sales
- Protected. Record a sale.
- Body example:
```
{
  "studentId": "3702",         // admissionNumber
  "items": [ { "name": "Coffee", "price": 10 } ],
  "total": 10
}
```
- Server re-validates item prices and total.
- If student has `dailyLimit`, the server rejects sales that would exceed it.

GET /api/sales/summary/today
- Protected. Response: `{ totalRevenue, transactionCount, topItem }`

GET /api/sales/report/export?from=YYYY-MM-DD&to=YYYY-MM-DD
- Protected. Streams `.xlsx` file containing Summary, Per-Class Spending, and Item Breakdown.

GET /api/sales/analytics/items?range=week|month
- Protected. Default `week`. Returns item counts and revenue in the requested window.

---

## Menu

GET /api/menu
- Public. Optional query `?active=true` returns only active items.
- Each item now includes `price`.

POST /api/menu
- Protected. Body: `{ "name": "Masala Tea", "image": "https://...", "price": 10, "isActive": false }`

PATCH /api/menu/:id
- Protected. Toggle `isActive`.

DELETE /api/menu/:id
- Protected. Delete item.

---

## Error codes
- `400` Bad Request — validation errors, total mismatch, limit exceeded
- `401` Unauthorized — missing/invalid JWT
- `404` Not Found — student/menu not found
- `409` Conflict — duplicate admission number
- `500` Internal Server Error — unexpected

---

## Quick curl examples

Login and save token (bash):
```bash
curl -s -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"changeme123"}' | jq -r '.token' > token.txt
```

Lookup student (public):
```bash
curl http://localhost:5000/api/students/lookup?admNo=3702
```

Create sale (protected):
```bash
TOKEN=$(cat token.txt)
curl -X POST http://localhost:5000/api/sales \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"studentId":"3702","items":[{"name":"Coffee","price":10}],"total":10}'
```

Export sales report (download):
```bash
curl -G -o report.xlsx "http://localhost:5000/api/sales/report/export" \
  -H "Authorization: Bearer $TOKEN" --data-urlencode "from=2024-05-01" --data-urlencode "to=2024-05-31"
```

---

If you want, I can also:
- Add automated tests for new endpoints (Jest + supertest).
- Implement bulkWrite optimization for `bulk-recharge` for large batches.
- Add OpenAPI / Postman collection.

  - Get all students
    - Method: GET
    - Path: `/api/students`
    - Auth: Bearer token (admin)
    - Query: optional `?class=4A`
    - Test:

```bash
curl -H 'Authorization: Bearer <TOKEN>' http://localhost:5000/api/students
```

  - Lookup student (public)
    - Method: GET
    - Path: `/api/students/lookup`
    - Auth: none
    - Query: `?admNo=1001`
    - Test:

```bash
curl "http://localhost:5000/api/students/lookup?admNo=1001"
```

  - Create student
    - Method: POST
    - Path: `/api/students`
    - Auth: Bearer token (admin)
    - Body: `{ "admissionNumber":"4001","name":"Name","class":"4A","balance":0 }`
    - Test:

```bash
curl -X POST http://localhost:5000/api/students \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"admissionNumber":"4001","name":"Student A","class":"4A","balance":0}'
```

  - Update student
    - Method: PUT
    - Path: `/api/students/:id`
    - Auth: Bearer token (admin)
    - Body: `{ "name": "Updated", "class": "5" }` (at least one field required)
    - Test:

```bash
curl -X PUT http://localhost:5000/api/students/<STUDENT_ID> \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"name":"Updated Name","class":"5"}'
```

  - Delete student
    - Method: DELETE
    - Path: `/api/students/:id`
    - Auth: Bearer token (admin)
    - Test:

```bash
curl -X DELETE http://localhost:5000/api/students/<STUDENT_ID> \
  -H 'Authorization: Bearer <TOKEN>'
```

  - Import students (bulk)
    - Method: POST
    - Path: `/api/students/import`
    - Auth: Bearer token (admin)
    - Body: `{ "rows": [ { admissionNumber, name, class, balance }, ... ] }`
    - Test:

```bash
curl -X POST http://localhost:5000/api/students/import \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"rows":[{"admissionNumber":"2001","name":"X","class":"4A","balance":0}]}'
```

  - Export students (xlsx)
    - Method: GET
    - Path: `/api/students/export`
    - Auth: Bearer token (admin)
    - Description: Streams an `.xlsx` file as response.
    - Test:

```bash
curl -H 'Authorization: Bearer <TOKEN>' http://localhost:5000/api/students/export --output Teapetti_students.xlsx
```

- **Sales**
  - Create sale (record purchase)
    - Method: POST
    - Path: `/api/sales`
    - Auth: Bearer token (admin)
    - Body: `{ "studentId": "1001", "items": [{ "name": "Coffee", "price": 10 }], "total": 10 }`
    - Description: Server recomputes total and atomically updates `balance`, `totalSpent`, and `history`.
    - Test:

```bash
curl -X POST http://localhost:5000/api/sales \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"studentId":"1001","items":[{"name":"Coffee","price":10}],"total":10}'
```

- **Menu**
  - Get menu items (public)
    - Method: GET
    - Path: `/api/menu`
    - Auth: none
    - Query: optional `?active=true`
    - Test:

```bash
curl http://localhost:5000/api/menu
curl "http://localhost:5000/api/menu?active=true"
```

  - Create menu item
    - Method: POST
    - Path: `/api/menu`
    - Auth: Bearer token (admin)
    - Body: `{ "name":"Masala Tea", "image":"https://...", "isActive": false }`
    - Test:

```bash
curl -X POST http://localhost:5000/api/menu \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"name":"Masala Tea","image":"https://example.com/t.jpg","isActive":false}'
```

  - Toggle/update menu item
    - Method: PATCH
    - Path: `/api/menu/:id`
    - Auth: Bearer token (admin)
    - Body: `{ "isActive": true }`
    - Test:

```bash
curl -X PATCH http://localhost:5000/api/menu/<MENU_ID> \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"isActive":true}'
```

  - Delete menu item
    - Method: DELETE
    - Path: `/api/menu/:id`
    - Auth: Bearer token (admin)
    - Test:

```bash
curl -X DELETE http://localhost:5000/api/menu/<MENU_ID> \
  -H 'Authorization: Bearer <TOKEN>'
```

---

Notes about authentication and tokens

- Acquire a token by calling `/api/auth/login` with the seeded admin credentials (`admin` / `changeme123` if you used the seed). The response body contains `token`.
- For all protected endpoints include the header `Authorization: Bearer <TOKEN>`.
- For testing convenience you can temporarily bypass authentication by editing `src/middleware/auth.middleware.js` to short-circuit `protect`, but do not do this in production or tests that assert auth behavior.

---

If you'd like, I can add these endpoint tests as runnable `supertest` integration specs under `tests/integration/` and wire them into `package.json` scripts. Would you like that? 
