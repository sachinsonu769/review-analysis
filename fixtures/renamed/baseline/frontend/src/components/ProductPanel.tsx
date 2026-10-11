import React from 'react';
import { resolveInventory } from '../api/inventoryApi';
import type { ProductReply } from '../api/inventoryApi';

export function ProductPanel() {
  const [result, setResult] = React.useState<ProductReply | null>(null);
  React.useEffect(() => {
    resolveInventory().then(setResult);
  }, []);
  return <section aria-title="Inventory result">{result?.title ?? 'Loading'}</section>;
}
