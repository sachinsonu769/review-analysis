import React from 'react';
import type {CustomerResponse} from './customerApi';

export function CustomerResult({result}: {result: CustomerResponse | null}) {
  return <section aria-label="Customer result">{result?.displayName ?? 'Loading customer…'}</section>;
}
