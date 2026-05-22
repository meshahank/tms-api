import 'dotenv/config';
import mongoose from 'mongoose';
import Student from './models/Student.js';
import MenuItem from './models/MenuItem.js';

const SAMPLE_STUDENTS = [
  { admissionNumber: '1001', name: 'Aisha Verma', class: '4A', balance: 120 },
  { admissionNumber: '1002', name: 'Ravi Kumar', class: '5', balance: -50 },
  { admissionNumber: '1003', name: 'Meera Nair', class: '6A', balance: 0 },
  { admissionNumber: '1004', name: 'Arjun Singh', class: '7B', balance: 30 },
];

const SAMPLE_MENU = [
  { name: 'Filter Coffee', image: 'https://example.com/images/filter_coffee.jpg', isActive: true },
  { name: 'Masala Tea', image: 'https://example.com/images/masala_tea.jpg', isActive: true },
  { name: 'Chocolate Muffin', image: 'https://example.com/images/muffin.jpg', isActive: false },
  { name: 'Veg Sandwich', image: 'https://example.com/images/sandwich.jpg', isActive: true },
];

async function seed() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not defined');
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB for seeding');

  try {
    // Seed students (upsert by admissionNumber)
    const studentOps = SAMPLE_STUDENTS.map((s) => ({
      updateOne: {
        filter: { admissionNumber: s.admissionNumber.toUpperCase() },
        update: {
          $setOnInsert: {
            admissionNumber: s.admissionNumber.toUpperCase(),
            name: s.name,
            class: s.class,
            balance: s.balance,
            totalCredit: s.balance > 0 ? s.balance : 0,
            totalSpent: s.balance < 0 ? Math.abs(s.balance) : 0,
            history: [],
          },
        },
        upsert: true,
      },
    }));

    const studentResult = await Student.bulkWrite(studentOps, { ordered: false });
    console.log('Students upsert result:', studentResult.nUpserted ?? studentResult.upsertedCount ?? 'unknown');

    // Seed menu items (upsert by name)
    const menuOps = SAMPLE_MENU.map((m) => ({
      updateOne: {
        filter: { name: m.name },
        update: { $setOnInsert: m },
        upsert: true,
      },
    }));

    const menuResult = await MenuItem.bulkWrite(menuOps, { ordered: false });
    console.log('Menu items upsert result:', menuResult.nUpserted ?? menuResult.upsertedCount ?? 'unknown');

    console.log('Seeding complete');
  } catch (err) {
    console.error('Seeding failed:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
