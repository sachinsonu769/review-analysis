import React from 'react';
import { lookup } from '../api/lookupApi';
import type { LookupResponse } from '../api/lookupApi';

export function LookupPanel() {
  const [result, setResult] = React.useState<LookupResponse | null>(null);
  React.useEffect(() => {
    lookup().then(setResult);
  }, []);
  return <section aria-label="Lookup result">{result?.label ?? 'Loading'}</section>;
}
