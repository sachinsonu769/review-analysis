import { Injectable } from '@angular/core';
import { view } from '../view';
@Injectable()
export class Order {
  public total = 0;
  private internal = 0;
  readonly id = 'order';
  submit(a: string, b: string, c: string, d: string, e: string, f: string) {
    return view(a + b + c + d + e + f + this.internal);
  }
}
