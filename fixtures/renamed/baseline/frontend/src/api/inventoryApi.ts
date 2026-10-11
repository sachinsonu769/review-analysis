export interface ProductReply {
  id: string;
  title: string;
}

export async function resolveInventory(): Promise<ProductReply> {
  const response = await fetch('/api/inventory/search');
  if (!response.ok) throw new Error('Inventory failed');
  return response.json();
}
