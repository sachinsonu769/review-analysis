import { Injectable } from '@angular/core';
import * as Http from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class DynamicLookupService {
  constructor(private readonly http: Http.HttpClient) {}

  lookup(segment: string) {
    return this.http.get<unknown>(`/api/${segment}`);
  }
}
