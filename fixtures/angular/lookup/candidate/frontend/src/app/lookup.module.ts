import { NgModule } from '@angular/core';
import { AppComponent } from './app.component';
import { LookupPanel } from './lookup-panel.component';
import { LookupService } from './lookup.service';

@NgModule({
  imports: [AppComponent, LookupPanel],
  exports: [AppComponent],
  providers: [LookupService],
})
export class LookupModule {}
