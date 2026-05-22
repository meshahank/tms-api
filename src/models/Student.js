import mongoose from 'mongoose';

export const STUDENT_CLASSES = ['1A', '1B', '2A', '2B', '3', '4A', '4B', '5', '6A', '6B', '7A', '7B'];

const saleItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  price: {
    type: Number,
    required: true,
  },
}, {
  _id: false,
});

const transactionSchema = new mongoose.Schema({
  date: {
    type: Date,
    default: Date.now,
  },
  items: {
    type: [saleItemSchema],
    default: [],
  },
  total: {
    type: Number,
    required: true,
  },
}, {
  _id: true,
});

const studentSchema = new mongoose.Schema({
  admissionNumber: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  class: {
    type: String,
    required: true,
    enum: STUDENT_CLASSES,
  },
  balance: {
    type: Number,
    default: 0,
  },
  totalCredit: {
    type: Number,
    default: 0,
  },
  totalSpent: {
    type: Number,
    default: 0,
  },
  history: {
    type: [transactionSchema],
    default: [],
  },
}, {
  timestamps: true,
});

studentSchema.virtual('computedBalance').get(function computedBalance() {
  return this.totalCredit - this.totalSpent;
});

studentSchema.set('toJSON', { virtuals: true });
studentSchema.set('toObject', { virtuals: true });

export default mongoose.model('Student', studentSchema);
