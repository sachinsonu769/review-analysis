export interface CustomerResponse {
  id: string;
  displayName: string;
}

// Demonstration source; requests are never run by the reviewer.
export async function lookupCustomer(id: string): Promise<CustomerResponse> {
  const response = await fetch(`/api/customers/lookup?id=${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error('Customer lookup failed');
  return response.json();
}
