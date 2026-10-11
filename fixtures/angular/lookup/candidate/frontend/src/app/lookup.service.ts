import { Injectable as Service } from '@angular/core';
import { HttpClient as AngularHttp } from '@angular/common/http';

export interface LookupResponse {
  id: string;
  displayName: string;
}

@Service({ providedIn: 'root' })
export class LookupService {
  constructor(private readonly http: AngularHttp) {}

  lookup() {
    return this.http.get<LookupResponse>('/api/catalog/lookup');
  }

  legacyLookup() {
    return this.http.request<LookupResponse>('GET', '/api/lookup');
  }
}
