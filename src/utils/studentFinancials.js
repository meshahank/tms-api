export function buildStudentFinancials(balance = 0) {
  const numericBalance = Number(balance);
  const normalizedBalance = Number.isFinite(numericBalance) ? numericBalance : 0;

  return {
    balance: normalizedBalance,
    totalCredit: normalizedBalance > 0 ? normalizedBalance : 0,
    totalSpent: normalizedBalance < 0 ? Math.abs(normalizedBalance) : 0,
  };
}
