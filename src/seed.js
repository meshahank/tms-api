import 'dotenv/config';
import mongoose from 'mongoose';
import Admin from './models/Admin.js';

async function seed() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not defined');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const username = 'admin';
  const existingAdmin = await Admin.findOne({ username });

  if (!existingAdmin) {
    await Admin.create({
      username,
      password: 'changeme123',
    });
    console.log('Admin created ✓');
  } else {
    console.log('Admin already exists ✓');
  }

  await mongoose.disconnect();
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
