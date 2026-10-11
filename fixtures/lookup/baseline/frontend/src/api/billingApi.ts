export async function loadInvoices() {
  // This endpoint is unrelated to the lookup contract.
  const response = await fetch('/api/billing/invoices');
  return response.json();
}
