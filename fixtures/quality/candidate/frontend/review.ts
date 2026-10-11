// A line inserted above existing declarations must not change their identity.
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
    if (value > 15) sum += value;
    if (value > 20) sum += value;
  }
  return sum;
}

export function resolved() {
  return true;
}

export function newIssue(value: number) {
  if (true) return value;
  return 0;
}

export const asyncIssue = new Promise(async resolve => {
  resolve(1);
});
