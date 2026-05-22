import ExcelJS from 'exceljs';
import Student from '../models/Student.js';

export async function exportStudents(res) {
  const students = await Student.find().sort({ class: 1, admissionNumber: 1 }).lean();

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Students');

  worksheet.columns = [
    { header: 'Admission No', key: 'admissionNumber', width: 16 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Class', key: 'class', width: 10 },
    { header: 'Balance (₹)', key: 'balance', width: 14 },
    { header: 'Total Credit', key: 'totalCredit', width: 14 },
    { header: 'Total Spent', key: 'totalSpent', width: 14 },
  ];

  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE07B1A' },
  };

  for (const student of students) {
    worksheet.addRow({
      admissionNumber: student.admissionNumber,
      name: student.name,
      class: student.class,
      balance: student.balance,
      totalCredit: student.totalCredit,
      totalSpent: student.totalSpent,
    });
  }

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const balanceCell = row.getCell(4);
    if (Number(balanceCell.value) < 0) {
      balanceCell.font = { color: { argb: 'FFE53935' }, bold: true };
    }
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Teapetti_students.xlsx"');

  await workbook.xlsx.write(res);
  res.end();
}
