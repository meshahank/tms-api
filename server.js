import 'dotenv/config';
import app from './src/app.js';
import { connectDB } from './src/config/db.js';

const port = Number(process.env.PORT ?? 5000);

async function start() {
  await connectDB();
  app.listen(port, () => {
    console.log(`Teapetti server running on port ${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
