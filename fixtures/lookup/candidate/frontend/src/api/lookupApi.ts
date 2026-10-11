export interface LookupResponse {
  id: string;
  displayName: string;
}

export async function lookup(): Promise<LookupResponse> {
  const response = await fetch('/api/catalog/lookup');
  if (!response.ok) throw new Error('Lookup failed');
  return response.json();
}
