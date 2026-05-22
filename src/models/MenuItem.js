import mongoose from 'mongoose';

const menuItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  image: {
    type: String,
    required: true,
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

export default mongoose.model('MenuItem', menuItemSchema);
