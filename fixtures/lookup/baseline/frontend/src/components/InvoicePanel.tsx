import React from 'react';
import { loadInvoices } from '../api/billingApi';

export function InvoicePanel() {
  React.useEffect(() => { void loadInvoices(); }, []);
  return <section>Invoices</section>;
}
