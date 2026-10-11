import { Component } from '@angular/core';
import { LookupPanel } from './lookup-panel.component';

@Component({
  selector: 'lookup-app',
  standalone: true,
  imports: [LookupPanel],
  template: '<lookup-panel></lookup-panel>',
})
export class AppComponent {}
