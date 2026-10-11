export interface ProductReply {
  id: string;
  description: string;
}

export async function resolveInventory(): Promise<ProductReply> {
  const response = await fetch('/api/warehouse/resolve');
  if (!response.ok) throw new Error('Inventory failed');
  return response.json();
}
