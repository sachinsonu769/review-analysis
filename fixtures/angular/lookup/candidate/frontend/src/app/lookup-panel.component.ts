import * as ng from '@angular/core';
import { LookupService, type LookupResponse } from './lookup.service';
import { LookupBadge } from './lookup-badge.component';

@ng.Component({
  selector: 'lookup-panel',
  standalone: true,
  imports: [LookupBadge],
  templateUrl: './lookup-panel.component.html',
})
export class LookupPanel {
  constructor(private readonly api: LookupService) {}

  load() {
    return this.api.lookup();
  }

  caption(response: LookupResponse): string {
    return response.label;
  }
}
