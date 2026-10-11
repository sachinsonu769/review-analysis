function Component(_metadata: unknown) {
  return (value: any) => value;
}

class HttpClient {
  get(_url: string): unknown { return null; }
}

@Component({
  selector: 'fake-product-panel',
  standalone: true,
  template: "fetch('/api/inventory/search')",
})
export class FakeProductPanel {
  constructor(private readonly http: HttpClient) {}

  load() {
    return this.http.get('/api/inventory/search');
  }
}

export const examples = [
  "@Component({ imports: [ProductPanel] })",
  "http.get('/api/inventory/search')",
  "fetch('/api/warehouse/resolve')",
];
// @Injectable() class CommentOnly { get() { fetch('/api/inventory/search'); } }
