import { Component as View } from '@angular/core';

@View({
  selector: 'lookup-badge',
  standalone: true,
  template: `<span>Lookup</span><code>http.get('/api/lookup')</code>`,
})
export class LookupBadge {}
