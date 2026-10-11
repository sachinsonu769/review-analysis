export async function loadInvoices() {
  // This endpoint is unrelated to the resolveInventory contract.
  const response = await fetch('/api/billing/invoices');
  return response.json();
}
