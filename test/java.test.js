import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJava } from '../src/java.js';

const parse = text => parseJava('Example.java', text);
const calls = result => result.references.filter(ref => ref.kind === 'call');
const springImports = 'import org.springframework.web.bind.annotation.*;';

test('CST declarations include annotated DTO contracts, nested types, interfaces, and records', () => {
  const result = parse(`package sample;
import java.util.List;
public class Envelope {
  @Deprecated private List<String> labels = List.of("a"), names[];
  public interface Api {
    @Deprecated String load(String id);
  }
}
record Payload(@Deprecated String id, int count) {}
`);
  assert.equal(result.language, 'java');
  assert.equal(result.unknowns.length, 0);
  assert.deepEqual(result.declarations.map(declaration => declaration.key).sort(), ['sample.Envelope', 'sample.Envelope#labels', 'sample.Envelope#names', 'sample.Envelope.Api', 'sample.Envelope.Api#load/1', 'sample.Payload', 'sample.Payload#count', 'sample.Payload#id'].sort());
  const method = result.declarations.find(declaration => declaration.kind === 'method');
  assert.deepEqual(method.range, { startLine: 6, endLine: 6 });
  assert.equal(method.signature, '@Deprecated String load(String id)');
  const labels = result.declarations.find(declaration => declaration.name === 'labels');
  assert.equal(labels.signature, '@Deprecated private List<String> labels');
  assert.match(labels.body, /List\.of\("a"\)/);
  const payload = result.declarations.find(declaration => declaration.name === 'Payload');
  assert.equal(payload.kind, 'record');
  assert.equal(payload.signature, 'record Payload(@Deprecated String id, int count)');
});

test('method keys preserve parameter contract changes and distinguish overload collisions', () => {
  const previous = parse('package sample; class Api { String find(String query) { return query; } }');
  const changed = parse('package sample; class Api { String find(Query query) { return ""; } }');
  const before = previous.declarations.find(declaration => declaration.kind === 'method');
  const after = changed.declarations.find(declaration => declaration.kind === 'method');
  assert.equal(before.key, after.key);
  assert.notEqual(before.signature, after.signature);
  const overloaded = parse('package sample; class Api { void find(String s) {} void find(Integer i) {} void run() { find(null); } }');
  assert.deepEqual(overloaded.declarations.filter(declaration => declaration.name === 'find').map(declaration => declaration.key), ['sample.Api#find/1(Integer)', 'sample.Api#find/1(String)']);
  assert.equal(calls(overloaded).find(call => call.name === 'find').target, undefined);
  assert.ok(overloaded.unknowns.some(unknown => /overload/.test(unknown.reason)));
});

test('literal Spring mappings combine class/method routes, arrays, HTTP restrictions, and exact lines', () => {
  const result = parse(`package sample;
${springImports}
@RequestMapping(path = {"/api", "/v2"}, method = RequestMethod.GET)
class Routes {
  @GetMapping(value = {"/items", "/items/{id}"})
  String read(String id) { return id; }
  @RequestMapping(path="/write", method=RequestMethod.POST)
  void write() {}
}`);
  assert.deepEqual(result.endpoints.map(endpoint => `${endpoint.method} ${endpoint.url}`).sort(), ['GET /api/items', 'GET /api/items/{id}', 'GET /v2/items', 'GET /v2/items/{id}', 'GET /api/write', 'GET /v2/write', 'POST /api/write', 'POST /v2/write'].sort());
  assert.deepEqual(result.endpoints[0].range, { startLine: 5, endLine: 5 });
  assert.equal(result.endpoints[0].declarationKey, 'sample.Routes#read/1');
  assert.equal(result.references.filter(ref => ref.kind === 'http').length, result.endpoints.length);
});

test('fully qualified annotations, static method imports, unrestricted methods, and Java string escapes', () => {
  const result = parse(String.raw`import org.springframework.web.bind.annotation.RequestMapping;
import static org.springframework.web.bind.annotation.RequestMethod.GET;
class Routes {
  @RequestMapping("/all") void all() {}
  @RequestMapping(path="\u002f\141", method=GET) void escaped() {}
  @org.springframework.web.bind.annotation.PostMapping("/save") void save() {}
}`);
  assert.deepEqual(result.endpoints.map(endpoint => [endpoint.method, endpoint.url]), [['*', '/all'], ['GET', '/a'], ['POST', '/save']]);
});

test('Spring constant expressions, config placeholders, custom names, and ambiguous annotations remain unknown', () => {
  const result = parse(`import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
@RequestMapping(BASE)
class Routes {
 @GetMapping("/valid") void inherited() {}
 @GetMapping("/" + CONSTANT) void concatenated() {}
 @GetMapping("\u0024{app.path}") void configuration() {}
 @GetMapping("/one") @RequestMapping("/two") void ambiguous() {}
}`);
  assert.deepEqual(result.endpoints, []);
  assert.ok(result.unknowns.some(unknown => /Dynamic Spring/.test(unknown.reason)));
  assert.ok(result.unknowns.some(unknown => /unresolved class/.test(unknown.reason)));
  assert.ok(result.unknowns.some(unknown => /Multiple Spring/.test(unknown.reason)));
  const custom = parse('@interface GetMapping { String value(); } class C { @GetMapping("/fake") void f() {} }');
  assert.deepEqual(custom.endpoints, []);
  assert.ok(custom.unknowns.some(unknown => /not verified/.test(unknown.reason)));
});

test('lexical field, parameter, local, and current-instance calls carry conservative receiver information', () => {
  const result = parse(`package sample;
import library.Worker;
class Consumer {
 private Worker worker;
 void accept(Worker parameter) {
   Worker local = parameter;
   worker.run(nested(1, 2), "x");
   this.worker.run();
   parameter.run();
   local.run();
   accept(parameter);
 }
 int nested(int a, int b) { return a; }
}`);
  const run = calls(result).filter(call => call.name === 'run');
  assert.equal(run.length, 4);
  assert.ok(run.every(call => call.receiverType === 'library.Worker' && !call.target));
  assert.equal(run[0].arity, 2);
  assert.deepEqual(run[0].range, { startLine: 7, endLine: 7 });
  assert.equal(calls(result).find(call => call.name === 'accept').target, 'sample.Consumer#accept/1');
  assert.equal(calls(result).find(call => call.name === 'nested').arity, 2);
  assert.ok(result.references.some(ref => ref.kind === 'type' && ref.name === 'Worker' && ref.target === 'library.Worker'));
});

test('block shadowing, inferred locals, chains, array receivers, and method references avoid invented targets', () => {
  const result = parse(`import library.Worker;
class Consumer {
 Worker worker;
 void run(Worker[] workers) {
  worker.act();
  { var worker = factory(); worker.act(); }
  worker.act();
  workers[0].act();
  factory().act();
  Runnable task = worker::act;
 }
 Worker factory() { return worker; }
}`);
  const acts = calls(result).filter(call => call.name === 'act');
  assert.deepEqual(acts.map(call => call.receiverType), ['library.Worker', undefined, 'library.Worker', undefined, undefined]);
  assert.ok(acts[1].dynamic && acts[3].dynamic && acts[4].dynamic);
  assert.ok(result.unknowns.some(unknown => /method reference/.test(unknown.reason)));
});

test('generic parameters, varargs, and lambda shadows cannot bind to concrete receiver types', () => {
  const generic = parse('class T {} class Outer<T> { class Inner { void f(T param) { param.go(); } } <T> void f(T param) { param.go(); } }');
  assert.ok(calls(generic).every(call => call.dynamic && !call.receiverType && !call.target));
  assert.ok(generic.references.filter(ref => ref.kind === 'type' && ref.name === 'T').every(ref => ref.dynamic && !ref.target));
  const varargs = parse('class Service {} record Group(Service... services) { void go(Service... args) { services.go(); args.go(); } }');
  assert.ok(calls(varargs).every(call => call.dynamic && !call.receiverType));
  const lambda = parse('class Service {} class C { Service service; void go(){ consume((Service service) -> service.go()); service.go(); } }');
  assert.deepEqual(calls(lambda).filter(call => call.name === 'go').map(call => call.receiverType), [undefined, 'Service']);
});

test('initializer, enhanced-for, and resource scopes do not leak into iterable expressions or catch/finally', () => {
  const result = parse(`class Service {} class Other {}
class C {
 Service service;
 { Other service = new Other(); service.go(); }
 void run() {
  for(Other service : service.values()) { service.go(); }
  try(Other service = new Other()) { service.go(); }
  catch(Exception e) { service.go(); }
  finally { service.go(); }
 }
}`);
  assert.deepEqual(calls(result).map(call => [call.name, call.receiverType]), [['go', 'Other'], ['values', 'Service'], ['go', 'Other'], ['go', 'Other'], ['go', 'Service'], ['go', 'Service']]);
});

test('anonymous and local classes do not merge methods or fields into a named owner', () => {
  const result = parse('enum E { A { Service service; void go(){ service.run(); } }; Other service; void go(){ service.run(); class Local { void f(){} } } }');
  assert.equal(result.declarations.filter(declaration => declaration.key.startsWith('E#go/')).length, 1);
  assert.equal(result.declarations.filter(declaration => declaration.key === 'E#service').length, 1);
  assert.deepEqual(calls(result).map(call => call.receiverType), ['Other']);
  assert.ok(result.unknowns.some(unknown => /Anonymous Java/.test(unknown.reason)));
  assert.ok(result.unknowns.some(unknown => /Local Java/.test(unknown.reason)));
  const argumentsOutsideBody = parse('class C { void f() { Object value = new Client(outer()) { void hidden() { inner(); } }; } Object outer(){ return null; } }');
  assert.deepEqual(calls(argumentsOutsideBody).map(call => call.name), ['outer']);
  assert.ok(argumentsOutsideBody.references.some(ref => ref.kind === 'type' && ref.name === 'Client'));
});

test('Spring enum constant shadows and wildcard composition remain unknown; empty arrays use defaults', () => {
  const shadowedType = parse(`${springImports}
@RequestMapping(method=RequestMethod.GET) class C {
 enum RequestMethod { GET }
 @GetMapping("/x") void go() {}
}`);
  assert.deepEqual(shadowedType.endpoints, []);
  const shadowedConstant = parse('import org.springframework.web.bind.annotation.RequestMapping; import static org.springframework.web.bind.annotation.RequestMethod.GET; class C { static final String GET="fake"; @RequestMapping(path="/x",method=GET) void go(){} }');
  assert.deepEqual(shadowedConstant.endpoints, []);
  const wildcard = parse(`${springImports} @RequestMapping("/hotels/*") class C { @GetMapping("/booking") void go(){} }`);
  assert.deepEqual(wildcard.endpoints, []);
  assert.ok(wildcard.unknowns.some(unknown => /wildcard path composition/.test(unknown.reason)));
  const empty = parse(`${springImports} @RequestMapping(path={},method={}) class C { @GetMapping("/x") void go(){} }`);
  assert.deepEqual(empty.endpoints.map(endpoint => [endpoint.method, endpoint.url]), [['GET', '/x']]);
});

test('CST parsing ignores fake code in comments and strings and reports bounded diagnostics', () => {
  const result = parse(`${springImports}
class C {
 // @GetMapping("/fake") void imaginary() { ghost.run(); }
 String text = "ghost.run() @GetMapping(\\\"/fake\\\")";
 /* class Ghost { void hidden() {} } */
 @GetMapping("/real") void actual() { real(); }
 void real() {}
}`);
  assert.deepEqual(result.endpoints.map(endpoint => endpoint.url), ['/real']);
  assert.deepEqual(calls(result).map(call => call.name), ['real']);
  assert.ok(!result.declarations.some(declaration => ['imaginary', 'Ghost', 'hidden'].includes(declaration.name)));
  const invalid = parse('class C { broken(');
  assert.deepEqual(invalid.declarations, []);
  assert.equal(invalid.unknowns[0].reason, 'Java parse error');
  assert.ok(invalid.unknowns[0].detail.length <= 1600);
});

test('parsing has deterministic JSON output and preserves input unchanged', () => {
  const text = 'record Data(String value) {}';
  const first = parseJava('/some/path/Data.java', text);
  const second = parseJava('/different/path/Data.java', text);
  assert.deepEqual(first, JSON.parse(JSON.stringify(second)));
  assert.equal(text, 'record Data(String value) {}');
});
