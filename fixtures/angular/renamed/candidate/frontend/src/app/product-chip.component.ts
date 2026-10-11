import { Component as View } from '@angular/core';

@View({
  selector: 'product-chip',
  standalone: true,
  template: `<span>Product</span><code>http.get('/api/inventory/search')</code>`,
})
export class ProductChip {}
