import { Router } from 'express';
import { protect } from '../middleware/auth.middleware.js';
import {
  createStudent,
  deleteStudent,
  exportStudentRows,
  getStudents,
  importStudentRows,
  lookupStudent,
  updateStudent,
} from '../controllers/student.controller.js';

const router = Router();

router.get('/', protect, getStudents);
router.get('/lookup', lookupStudent);
router.post('/import', protect, importStudentRows);
router.get('/export', protect, exportStudentRows);
router.post('/', protect, createStudent);
router.put('/:id', protect, updateStudent);
router.delete('/:id', protect, deleteStudent);

export const studentRoutes = router;
