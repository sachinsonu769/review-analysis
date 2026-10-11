export interface LookupResponse {
  id: string;
  label: string;
}

export async function lookup(): Promise<LookupResponse> {
  const response = await fetch('/api/lookup');
  if (!response.ok) throw new Error('Lookup failed');
  return response.json();
}
