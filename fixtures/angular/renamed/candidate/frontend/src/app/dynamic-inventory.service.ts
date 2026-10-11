import { Injectable } from '@angular/core';
import * as Http from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class DynamicInventoryClient {
  constructor(private readonly http: Http.HttpClient) {}

  resolveInventory(segment: string) {
    return this.http.get<unknown>(`/api/${segment}`);
  }
}
