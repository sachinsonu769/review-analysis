export function risky(value?: string) {
  const normalized = value!;
  return normalized;
}

export function calculate(values: number[]) {
  let sum = 0;
  for (const value of values) {
    if (value > 0) sum += value;
    if (value > 5) sum += value;
    if (value > 10) sum += value;
  }
  return sum;
}

export function resolved() {
  return true;
  console.log('unreachable in baseline');
}
