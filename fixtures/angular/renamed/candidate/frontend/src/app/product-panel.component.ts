import * as ng from '@angular/core';
import { InventoryClient, type ProductReply } from './inventory.service';
import { ProductChip } from './product-chip.component';

@ng.Component({
  selector: 'product-panel',
  standalone: true,
  imports: [ProductChip],
  templateUrl: './product-panel.component.html',
})
export class ProductPanel {
  constructor(private readonly api: InventoryClient) {}

  load() {
    return this.api.resolveInventory();
  }

  summary(response: ProductReply): string {
    return response.title;
  }
}
