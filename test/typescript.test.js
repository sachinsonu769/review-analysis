import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTypeScript } from '../src/typescript.js';

const parse = (text, path = 'src/example.ts') => parseTypeScript(path, text);
const refs = (result, kind) => result.references.filter((reference) => reference.kind === kind);
const declaration = (result, key) => result.declarations.find((entry) => entry.key === key);

test('extracts declarations, member contracts, annotations and exact source ranges', () => {
  const result = parse(`export interface Payload<T extends { id: string }> {
  readonly label?: string;
  load(key: T): Promise<T>;
  [name: string]: unknown;
}
export type Identifier = string | number;
export type Actions = { perform(id: Identifier): void };
@sealed
export class Store {
  constructor(public id: string) {}
  @logged
  load(key: Identifier): string {
    return String(key);
  }
}
export const title: string = 'hello';
export function choose(id: Identifier): string {
  return String(id);
}
`);
  assert.deepEqual(declaration(result, 'Payload').range, { startLine: 1, endLine: 5 });
  assert.match(declaration(result, 'Payload').signature, /T extends \{ id: string \}/);
  assert.equal(declaration(result, 'Payload.label').signature, 'readonly label?: string;');
  assert.equal(declaration(result, 'Payload.load').signature, 'load(key: T): Promise<T>;');
  assert.equal(declaration(result, 'Payload.$index1').kind, 'index-signature');
  assert.equal(declaration(result, 'Actions.perform').owner, 'Actions');
  assert.match(declaration(result, 'Store.load').signature, /@logged/);
  assert.doesNotMatch(declaration(result, 'Store').signature, /return String/);
  assert.match(declaration(result, 'Store.id').signature, /public id: string/);
  assert.equal(declaration(result, 'title').signature, 'export const title: string');
  assert.equal(declaration(result, 'choose').signature, 'export function choose(id: Identifier): string');
  assert.match(declaration(result, 'choose').body, /return String\(id\)/);
  assert.equal(result.language, 'typescript');
  assert.deepEqual(result.endpoints, []);
});

test('stable declaration identities separate contract changes from implementation changes', () => {
  const first = parse('export function compute(value: number): number { return value + 1; }');
  const bodyChange = parse('export function compute(value: number): number { return value + 2; }');
  const typeChange = parse('export function compute(value: string): string { return value; }');
  assert.equal(first.declarations[0].key, bodyChange.declarations[0].key);
  assert.equal(first.declarations[0].signature, bodyChange.declarations[0].signature);
  assert.notEqual(first.declarations[0].body, bodyChange.declarations[0].body);
  assert.equal(first.declarations[0].key, typeChange.declarations[0].key);
  assert.notEqual(first.declarations[0].signature, typeChange.declarations[0].signature);
  const arrowOne = parse('export const compute = (value: number): number => value + 1;');
  const arrowTwo = parse('export const compute = (value: number): number => value + 2;');
  assert.equal(arrowOne.declarations[0].signature, arrowTwo.declarations[0].signature);
});

test('combines overload signatures without losing the implementation or stable identity', () => {
  const result = parse(`export function convert(value: string): string;
export function convert(value: number): number;
export function convert(value: unknown): unknown { return value; }
class Converter {
  convert(value: string): string;
  convert(value: unknown): unknown { return value; }
  get label(): string { return 'x'; }
  set label(value: string) {}
}`);
  assert.equal(result.declarations.filter((entry) => entry.key === 'convert').length, 1);
  assert.match(declaration(result, 'convert').signature, /value: string/);
  assert.match(declaration(result, 'convert').signature, /value: number/);
  assert.match(declaration(result, 'convert').body, /return value/);
  assert.match(declaration(result, 'Converter.convert').signature, /value: unknown/);
  assert.match(declaration(result, 'Converter.label').signature, /get label/);
  assert.match(declaration(result, 'Converter.label').signature, /set label/);
});

test('captures named/default/namespace import aliases and source-only local targets', () => {
  const result = parse(`import defaultAction from './actions';
import { run as execute, type Payload as Data } from './actions';
import * as actions from './actions';
export function main(input: Data) { execute(input); defaultAction(); actions.run(); later(); }
function later() {}
const handler = () => later();
handler();
`);
  assert.deepEqual(refs(result, 'import').map(({ name, module, imported }) => ({ name, module, imported })), [
    { name: 'defaultAction', module: './actions', imported: 'default' },
    { name: 'execute', module: './actions', imported: 'run' },
    { name: 'Data', module: './actions', imported: 'Payload' },
    { name: 'actions', module: './actions', imported: '*' },
  ]);
  const importedCall = refs(result, 'call').find((reference) => reference.name === 'execute');
  assert.equal(importedCall.imported, 'run');
  assert.equal(importedCall.module, './actions');
  assert.equal(importedCall.target, undefined);
  assert.equal(importedCall.caller, 'main');
  assert.equal(refs(result, 'call').find((reference) => reference.receiver === 'actions').imported, 'run');
  assert.equal(refs(result, 'call').find((reference) => reference.name === 'handler').target, 'handler');
  assert.equal(refs(result, 'call').filter((reference) => reference.name === 'later').every((reference) => reference.target === 'later'), true);
  assert.equal(refs(result, 'type').find((reference) => reference.name === 'Data').imported, 'Payload');
});

test('shadowing, destructured parameters, catch bindings and block locals prevent false HTTP/import resolution', () => {
  const result = parse(`import client from 'axios';
import { run as execute } from './actions';
function outer(fetch: any, client: any, execute: any) {
  fetch('/shadow'); client.get('/shadow'); execute();
}
function destructured({ fetch, client }: any) { fetch('/shadow'); client.get('/shadow'); }
try {} catch (fetch) { fetch('/shadow'); }
{ let fetch = () => null; fetch('/shadow'); }
{ const client = { get() {} }; client.get('/shadow'); }
client.get('/actual');
fetch('/actual');
`);
  assert.deepEqual(refs(result, 'http').map(({ url }) => url), ['/actual', '/actual']);
  assert.equal(refs(result, 'call').find((reference) => reference.name === 'execute').module, undefined);
  assert.equal(refs(result, 'call').find((reference) => reference.name === 'execute').target, undefined);
});

test('maps class and interface members only when a local Compiler API symbol resolves', () => {
  const result = parse(`interface Worker { run(value: string): void; }
class Local { run() {} go() { this.run(); } }
export function use(worker: Worker, other: any) { worker.run('x'); other.run('x'); }
const local = new Local(); local.run();
`);
  const calls = refs(result, 'call');
  assert.equal(calls.find((reference) => reference.receiver === 'this').target, 'Local.run');
  assert.equal(calls.find((reference) => reference.receiver === 'worker').target, 'Worker.run');
  assert.equal(calls.find((reference) => reference.receiver === 'worker').receiverType, 'Worker');
  assert.equal(calls.find((reference) => reference.receiver === 'other').target, undefined);
  assert.equal(calls.find((reference) => reference.receiver === 'local').target, 'Local.run');
  assert.equal(calls.find((reference) => reference.receiver === 'local').receiverType, 'Local');
});

test('extracts fetch HTTP literals, aliases, static templates and method defaults', () => {
  const result = parse("import request from 'node-fetch';\nimport {fetch as send} from 'undici';\nfetch('/read');\nfetch(`/template`, {method: 'post'});\nrequest('/alias', {method: 'delete'});\nsend('/named');\nglobalThis.fetch('/global', {headers: {a:'b'}});\n");
  assert.deepEqual(refs(result, 'http').map(({ url, method }) => ({ url, method })), [
    { url: '/read', method: 'GET' }, { url: '/template', method: 'POST' },
    { url: '/alias', method: 'DELETE' }, { url: '/named', method: 'GET' },
    { url: '/global', method: 'GET' },
  ]);
  assert.equal(result.unknowns.length, 0);
});

test('supports imported axios callable, config, request, namespace and HTTP verb forms', () => {
  const result = parse(`import http from 'axios';
import * as client from 'axios';
http.get('/read');
http.post('/create', {value:1});
http('/update', {method: 'put'});
http({url: '/config', method: 'patch'});
http.request({url: '/request'});
client.delete('/remove');
const pretend = {get() {}}; pretend.get('/not-http');
`);
  assert.deepEqual(refs(result, 'http').map(({ url, method }) => ({ url, method })), [
    { url: '/read', method: 'GET' }, { url: '/create', method: 'POST' },
    { url: '/update', method: 'PUT' }, { url: '/config', method: 'PATCH' },
    { url: '/request', method: 'GET' }, { url: '/remove', method: 'DELETE' },
  ]);
});

test('dynamic URLs, methods and nonliteral options are explicit unknowns', () => {
  const result = parse("import http from 'axios';\nfetch(`${base}/${key}`);\nfetch('/fixed', options);\nfetch('/fixed', {method: verb});\nfetch('/prefix' + key);\nhttp.get(path);\nhttp.request(config);\nhttp(config);\n");
  assert.equal(refs(result, 'http').length, 7);
  assert.equal(refs(result, 'http').every((entry) => entry.dynamic === true), true);
  assert.equal(result.unknowns.some((entry) => entry.reason === 'dynamic_http_url'), true);
  assert.equal(result.unknowns.some((entry) => entry.reason === 'dynamic_http_method'), true);
  assert.equal(refs(result, 'http').find((entry) => entry.range.startLine === 3).method, undefined);
  assert.equal(refs(result, 'http').find((entry) => entry.range.startLine === 2).url, undefined);
  assert.equal(refs(result, 'http').find((entry) => entry.range.startLine === 8).method, undefined);
});

test('object spreads and computed options cannot be mistaken for known HTTP contracts', () => {
  const result = parse(`import http from 'axios';
fetch('/x', {method:'POST', ...extra});
fetch('/x', {[key]: 'POST'});
http({url:'/x', method:'POST', ...extra});
fetch('/last', {method:'POST', method:'DELETE'});
`);
  const http = refs(result, 'http');
  assert.equal(http[0].method, undefined);
  assert.equal(http[1].method, undefined);
  assert.equal(http[2].url, undefined);
  assert.equal(http[2].method, undefined);
  assert.equal(http[3].method, 'DELETE');
});

test('computed property and indirect calls emit unknowns without fabricated targets', () => {
  const result = parse(`import http from 'axios';
http['get']('/x');
http[verb]('/x');
getFactory()('/x');
class Example { [dynamic](key: string) {} }
`);
  assert.equal(result.unknowns.filter((entry) => entry.reason === 'computed_property_call').length, 2);
  assert.equal(result.unknowns.some((entry) => entry.reason === 'dynamic_call'), true);
  assert.equal(result.unknowns.some((entry) => entry.reason === 'computed_declaration_name'), true);
  assert.equal(refs(result, 'http').length, 0);
  assert.equal(refs(result, 'call').filter((entry) => entry.dynamic).every((entry) => entry.target === undefined), true);
});

test('comments and strings are captured as source but never interpreted as calls or routes', () => {
  const result = parse(`// fetch('/comment'); http.get('/comment');
export const decoy = "fetch('/string'); import fake from './fake'";
/* function fake() { fetch('/block'); } */
export function real() { return "http.get('/body-string')"; }
`);
  assert.equal(refs(result, 'http').length, 0);
  assert.equal(refs(result, 'call').length, 0);
  assert.equal(refs(result, 'import').length, 0);
  assert.equal(result.declarations.some((entry) => entry.name === 'fake'), false);
  assert.match(declaration(result, 'real').body, /http.get/);
});

test('TSX supports React component references while JSX text remains text', () => {
  const result = parse(`import React from 'react';
import { Panel as Card } from './Panel';
export interface Props { title: string; }
export const Screen = (props: Props) => <main><Card title={props.title}/><p>fetch('/text')</p></main>;
`, 'src/Screen.tsx');
  assert.equal(result.unknowns.length, 0);
  assert.equal(refs(result, 'http').length, 0);
  const component = refs(result, 'type').find((entry) => entry.name === 'Card');
  assert.equal(component.module, './Panel');
  assert.equal(component.imported, 'Panel');
  assert.equal(component.caller, 'Screen');
  assert.equal(refs(result, 'type').some((entry) => entry.name === 'main'), false);
  assert.equal(refs(result, 'type').find((entry) => entry.name === 'Props').target, 'Props');
});

test('TS generic arrow syntax is not parsed as JSX and optional calls retain bindings', () => {
  const result = parse(`export const identity = <T>(value: T): T => value;
identity?.(1);
`);
  assert.equal(result.unknowns.some((entry) => entry.reason === 'parse_diagnostic'), false);
  assert.equal(refs(result, 'call')[0].target, 'identity');
});

test('syntax errors produce diagnostics with source ranges instead of throwing', () => {
  const result = parse('export function broken(value: {\n  return value;\n');
  assert.equal(result.unknowns.some((entry) => entry.reason === 'parse_diagnostic'), true);
  assert.equal(result.unknowns.filter((entry) => entry.reason === 'parse_diagnostic').every((entry) => Number.isInteger(entry.range.startLine)), true);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('renamed equivalent fixtures retain generic parser behavior', () => {
  const fixture = (type, field, action, alias, route) => `import { ${action} as ${alias} } from './client';
export interface ${type} { ${field}: string; }
export function load(value: ${type}) { ${alias}(value); return fetch('${route}'); }
`;
  const original = parse(fixture('LookupResponse', 'label', 'lookup', 'requestLookup', '/api/lookup'));
  const renamed = parse(fixture('Parcel', 'caption', 'retrieve', 'requestParcel', '/v2/parcels'));
  assert.equal(original.declarations.length, renamed.declarations.length);
  assert.deepEqual(original.declarations.map(({ kind }) => kind), renamed.declarations.map(({ kind }) => kind));
  assert.equal(declaration(renamed, 'Parcel.caption').signature, 'caption: string;');
  assert.equal(refs(renamed, 'call').find((entry) => entry.name === 'requestParcel').imported, 'retrieve');
  assert.equal(refs(renamed, 'http')[0].url, '/v2/parcels');
  assert.equal(renamed.unknowns.length, original.unknowns.length);
});

test('returned data is deterministic JSON with source-relative line ranges', () => {
  const source = '\nexport function main() {\n  return fetch(\'/api\');\n}\n';
  const first = parse(source, '/arbitrary/path.ts');
  const second = parse(source, '/other/path.ts');
  assert.deepEqual(first, second);
  assert.deepEqual(declaration(first, 'main').range, {startLine: 2, endLine: 4});
  assert.deepEqual(refs(first, 'http')[0].range, {startLine: 3, endLine: 3});
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
});

test('namespace members, destructured bindings, enums and type-only calls remain explicit', () => {
  const result = parse(`import type { Callable } from './module';
namespace Api { export function run() {} }
Api.run();
export const {first: primary, second} = factory();
primary(); second();
enum Mode { Ready = 'ready', Done = 'done' }
Callable();
`);
  assert.equal(declaration(result, 'Api.run').owner, 'Api');
  assert.equal(refs(result, 'call').find((entry) => entry.receiver === 'Api').target, 'Api.run');
  assert.equal(refs(result, 'call').find((entry) => entry.name === 'primary').target, 'primary');
  assert.equal(refs(result, 'call').find((entry) => entry.name === 'second').target, 'second');
  assert.equal(declaration(result, 'Mode.Ready').kind, 'enum-member');
  assert.equal(result.unknowns.some((entry) => entry.reason === 'type_only_import_call'), true);
});
