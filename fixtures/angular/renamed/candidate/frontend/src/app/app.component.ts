import { Component } from '@angular/core';
import { ProductPanel } from './product-panel.component';

@Component({
  selector: 'inventory-app',
  standalone: true,
  imports: [ProductPanel],
  template: '<product-panel></product-panel>',
})
export class AppComponent {}
