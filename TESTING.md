# Teapetti Backend — Testing Guide

This document describes how to test the Teapetti backend (unit, integration, and manual API tests), plus recommended dev dependencies and CI configuration.

**Quick start**

1. Install dev dependencies (see `package.json` and commands below).
2. Create a `.env.test` file (example below).
3. Run unit tests: `npm test` (after adding test script).
4. Run integration tests: `npm run test:integration`.

**Files referenced**
- Server entry: [server.js](server.js)
- App: [src/app.js](src/app.js)
- Seed script: [src/seed.js](src/seed.js)

---

## Recommended Test Dependencies

Install the following as dev dependencies:

```bash
npm install -D jest @types/jest supertest mongodb-memory-server-core cross-env
```

- `jest`: test runner and assertion library.
- `supertest`: HTTP assertions for integration tests.
- `mongodb-memory-server-core`: ephemeral in-memory MongoDB for fast, isolated integration tests.
- `cross-env`: set environment variables in npm scripts across platforms.

You can also use `vitest` instead of `jest` if you prefer a faster modern runner.

---

## Suggested package.json scripts

Add these scripts to `package.json`:

```json
"scripts": {
  "dev": "nodemon server.js",
  "start": "node server.js",
  "seed": "node src/seed.js",
  "test": "cross-env NODE_ENV=test jest --runInBand",
  "test:watch": "cross-env NODE_ENV=test jest --watch",
  "test:integration": "cross-env NODE_ENV=test jest --runInBand --config jest.integration.config.js"
}
```

Notes:
- `--runInBand` runs tests serially which is easier for tests that spin up a real or in-memory DB.
- Consider separate Jest configs for unit vs integration tests.

---

## Environment for tests

Create a `.env.test` at the project root with test-specific values. Example:

```
PORT=5001
NODE_ENV=test
MONGO_URI=mongodb://127.0.0.1:27017/Teapetti_test
JWT_SECRET=test_jwt_secret
JWT_EXPIRES_IN=7d
CLIENT_URL=http://localhost:5173
```

In integration tests we prefer `mongodb-memory-server` so `MONGO_URI` is created dynamically by the test harness — see the example below.

---

## Unit tests (fast, pure logic)

- Focus on utilities and pure functions (e.g. `src/utils/studentFinancials.js`).
- Use Jest to test small units with deterministic inputs.

Example `tests/utils/studentFinancials.test.js`:

```js
import { buildStudentFinancials } from '../../src/utils/studentFinancials.js';

test('builds correct financials for positive balance', () => {
  expect(buildStudentFinancials(120)).toEqual({ balance: 120, totalCredit: 120, totalSpent: 0 });
});

test('builds correct financials for negative balance', () => {
  expect(buildStudentFinancials(-50)).toEqual({ balance: -50, totalCredit: 0, totalSpent: 50 });
});
```

Run unit tests with:

```bash
npm test
```

---

## Integration tests (API + DB)

These tests exercise the full Express stack and a real MongoDB (in-memory for CI/local).

Key ideas:
- Start the app using the `app` import (do not call `server.listen` directly in tests).
- Use `mongodb-memory-server` to create a MongoDB URI per test run.
- Use `supertest` to make HTTP requests against `app`.
- Seed required data (admin) in a `beforeAll` hook and clean up between tests.

Example `tests/integration/sale.integration.test.js`:

```js
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import app from '../../src/app.js';
import Admin from '../../src/models/Admin.js';

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
  await Admin.create({ username: 'admin', password: 'changeme123' });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('record a sale updates student balance and history', async () => {
  // create a student
  const createRes = await request(app)
    .post('/api/students')
    .set('Authorization', `Bearer dummy`) // you may mock auth or issue real JWT
    .send({ admissionNumber: 'T100', name: 'Test Student', class: '4A' });

  // For a proper test obtain a token via /api/auth/login or mock protect middleware
  // This example focuses on structure; adapt auth to your test approach.
  expect(createRes.status).toBe(201);
});
```

Auth in integration tests:
- Option A: Use the real `/api/auth/login` endpoint and store token.
- Option B: Bypass `protect` by mocking the middleware (only for isolated tests).

---

## Manual API tests (curl / Postman)

Use these curl snippets to exercise the running server at `http://localhost:5000`.

- Login (admin):

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"changeme123"}'
```

- Create a student (requires admin token):

```bash
curl -X POST http://localhost:5000/api/students \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"admissionNumber":"4001","name":"Student A","class":"4A","balance":0}'
```

- Lookup student (public):

```bash
curl "http://localhost:5000/api/students/lookup?admNo=4001"
```

- Record a sale (admin):

```bash
curl -X POST http://localhost:5000/api/sales \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"studentId":"4001","items":[{"name":"Coffee","price":10}],"total":10}'
```

---

## Excel import/export tests

- To exercise import: send a POST to `/api/students/import` with a JSON body `{ "rows": [ ... ] }` as specified in the docs.
- To test export: GET `/api/students/export` while authenticated; the response will be an `.xlsx` file stream.

You can write an integration test that uploads parsed rows or call the import helper directly from tests.

---

## CI (GitHub Actions) example

Save this as `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test
        env:
          NODE_ENV: test
```

If using `mongodb-memory-server`, tests that require MongoDB will run without external services.

---

## Troubleshooting

- If tests fail due to `EADDRINUSE`, ensure test server uses a different port or do not call `app.listen` during tests — import `app` directly.
- If MongoDB connection fails, verify `mongodb-memory-server` is installed and compatible with your Node version.
- For JWT-related failures in tests, either issue a real token via `/api/auth/login` against the seeded admin, or mock the `protect` middleware.

---

If you'd like, I can also:

- Add example Jest config files (`jest.config.js` and `jest.integration.config.js`).
- Add sample test files for unit and integration tests.
- Commit sample CI YAML into the repo.

Tell me which of those you'd like me to create next.

---

## API Endpoints (complete list)

Below is a concise, authoritative list of all backend API endpoints implemented in this repository, with HTTP method, path, whether authentication is required, a short description, and example curl commands you can run locally.

Base URL: http://localhost:5000

- **Health**
  - Method: GET
  - Path: `/health`
  - Auth: none
  - Description: Basic liveness check.
  - Test:

```bash
curl http://localhost:5000/health
```

- **Auth**
  - Login
    - Method: POST
    - Path: `/api/auth/login`
    - Auth: none
    - Description: Returns a JWT for admin users.
    - Request body: `{ "username": "admin", "password": "changeme123" }`
    - Test:

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"changeme123"}'
```

  - Logout
    - Method: POST
    - Path: `/api/auth/logout`
    - Auth: Bearer token (admin)
    - Description: Stateless logout endpoint (client-side token discard).
    - Test:

```bash
curl -X POST http://localhost:5000/api/auth/logout \
  -H 'Authorization: Bearer <TOKEN>'
```

- **Students**
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
