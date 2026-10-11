import { Component, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class BillingService {
  constructor(private readonly http: HttpClient) {}

  invoice() {
    return this.http.get('/api/billing/invoice');
  }
}

@Component({
  selector: 'billing-panel',
  standalone: true,
  template: '<p>Billing is independent of lookup.</p>',
})
export class BillingPanel {
  constructor(private readonly billing: BillingService) {}

  load() {
    return this.billing.invoice();
  }
}
