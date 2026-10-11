import { NgModule } from '@angular/core';
import { AppComponent } from './app.component';
import { ProductPanel } from './product-panel.component';
import { InventoryClient } from './inventory.service';

@NgModule({
  imports: [AppComponent, ProductPanel],
  exports: [AppComponent],
  providers: [InventoryClient],
})
export class InventoryModule {}
