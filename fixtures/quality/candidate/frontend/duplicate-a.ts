export function summarizeA(values: number[]) {
  let total = 0;
  let accepted = 0;
  for (const value of values) {
    if (value > 0) {
      total += value;
      accepted += 1;
    }
  }
  const average = accepted === 0 ? 0 : total / accepted;
  return { total, accepted, average };
}
