function Component(_metadata: unknown) {
  return (value: any) => value;
}

class HttpClient {
  get(_url: string): unknown { return null; }
}

@Component({
  selector: 'fake-lookup-panel',
  standalone: true,
  template: "fetch('/api/lookup')",
})
export class FakeLookupPanel {
  constructor(private readonly http: HttpClient) {}

  load() {
    return this.http.get('/api/lookup');
  }
}

export const examples = [
  "@Component({ imports: [LookupPanel] })",
  "http.get('/api/lookup')",
  "fetch('/api/catalog/lookup')",
];
// @Injectable() class CommentOnly { get() { fetch('/api/lookup'); } }
