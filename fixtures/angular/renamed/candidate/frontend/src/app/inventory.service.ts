import { Injectable as Service } from '@angular/core';
import { HttpClient as AngularHttp } from '@angular/common/http';

export interface ProductReply {
  id: string;
  description: string;
}

@Service({ providedIn: 'root' })
export class InventoryClient {
  constructor(private readonly http: AngularHttp) {}

  resolveInventory() {
    return this.http.get<ProductReply>('/api/warehouse/resolve');
  }

  legacyInventory() {
    return this.http.request<ProductReply>('GET', '/api/inventory/search');
  }
}
