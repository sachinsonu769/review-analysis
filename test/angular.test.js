import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { analyze } from '../src/engine.js';
import { parseTypeScript } from '../src/typescript.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parse = (text) => parseTypeScript('frontend/src/example.ts', text);
const http = (result) => result.references.filter((reference) => reference.kind === 'http');
const reasons = (result) => result.unknowns.map((entry) => entry.reason);

test('verified Angular decorators capture aliased/namespace metadata and source dependencies', () => {
  const result = parse(`import { Component as View, Injectable } from '@angular/core';
import * as Angular from '@angular/core';
import { CommonModule } from '@angular/common';
import { DetailPanel as Panel } from './detail-panel';
class LocalBadge {}
@Injectable({providedIn: 'root'})
export class ApiService {}
@View({selector: 'app-view', standalone: true, imports: [CommonModule, Panel, LocalBadge], providers: [ApiService], template: '<local-badge />'})
export class Screen {}
@Angular.NgModule({imports: [Screen], declarations: [LocalBadge], exports: [Screen], providers: [ApiService], bootstrap: [Screen]})
export class AppModule {}
`);
  const [component] = result.angular.components;
  assert.equal(component.declarationKey, 'Screen');
  assert.equal(component.selector, 'app-view');
  assert.equal(component.standalone, true);
  assert.equal(component.imports[0].module, '@angular/common');
  assert.equal(component.imports[1].module, './detail-panel');
  assert.equal(component.imports[1].imported, 'DetailPanel');
  assert.equal(component.imports[2].target, 'LocalBadge');
  assert.equal(component.providers[0].target, 'ApiService');
  assert.equal(component.template.kind, 'inline');
  assert.equal(component.template.analysis, 'unverified');
  assert.deepEqual(component.range, {startLine: 8, endLine: 8});
  assert.equal(result.angular.injectables[0].providedIn, 'root');
  assert.equal(result.angular.modules[0].declarationKey, 'AppModule');
  assert.equal(result.angular.modules[0].declarations[0].target, 'LocalBadge');
  assert.equal(result.angular.modules[0].bootstrap[0].target, 'Screen');
  const ref = result.references.find((entry) => entry.framework === 'angular' && entry.name === 'Panel');
  assert.equal(ref.kind, 'type');
  assert.equal(ref.caller, 'Screen');
  assert.equal(ref.metadata, 'imports');
  assert.ok(reasons(result).includes('angular_template_unverified'));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('Angular facts never arise from unverified decorator names or lexical shadows', () => {
  const result = parse(`import {Component as View} from '@angular/core';
import {Injectable} from './pretend';
import type {NgModule} from '@angular/core';
function Component(config: any) { return (target: any) => target; }
@Component({selector:'fake'}) class Fake {}
@Injectable({providedIn:'root'}) class FakeService {}
@NgModule({imports:[]}) class FakeModule {}
function nested(View: any) {
  @View({selector:'shadow'}) class Shadow {}
}
`);
  assert.equal(result.angular, undefined);
  assert.ok(reasons(result).includes('type_only_import_call'));
});

test('metadata defaults stay unspecified and dynamic properties/dependencies remain unknown', () => {
  const result = parse(`import {Component, Injectable, NgModule} from '@angular/core';
import {Panel} from './panel';
@Component({selector: choose(), imports: [Panel, ...extra], template: content}) class Dynamic {}
@Component({selector:'overridden', standalone:true, ...override}) class Spread {}
@Component({imports: registry}) class Registry {}
@Component({template:'x'}) class Defaults {}
@Injectable() class BareService {}
@Injectable({providedIn: null}) class LocalService {}
@NgModule(moduleConfig) class DynamicModule {}
@Component({selector:'old', get selector() {return chosen;}}) class GetterOverride {}
`);
  assert.equal(result.angular.components[0].selector, undefined);
  assert.equal(result.angular.components[0].imports.length, 1);
  assert.equal(result.angular.components[1].selector, undefined);
  assert.equal(result.angular.components[1].standalone, undefined);
  assert.equal(result.angular.components[2].imports, undefined);
  assert.equal(result.angular.components[3].standalone, undefined);
  assert.equal(result.angular.components[4].selector, undefined);
  assert.equal(result.angular.injectables[0].providedIn, undefined);
  assert.equal(result.angular.injectables[1].providedIn, null);
  assert.ok(reasons(result).includes('angular_dynamic_metadata'));
  assert.ok(reasons(result).includes('angular_template_unverified'));
});

test('inline Angular template text and external template URLs cannot fabricate TypeScript calls', () => {
  const result = parse(`import {Component} from '@angular/core';
@Component({standalone:true, template: \`<p>{{ fetch('/api/lookup') }}</p><button (click)="http.get('/api/lookup')">Load</button>\`})
export class Inline {}
@Component({templateUrl: './external.html'}) export class External {}
// this.http.get('/comment')
const decoy = "this.http.get('/string')";
`);
  assert.equal(http(result).length, 0);
  assert.deepEqual(result.references.filter((entry) => entry.kind === 'call').map((entry) => entry.name), ['Component', 'Component']);
  assert.match(result.angular.components[0].template.text, /fetch\('\/api\/lookup'\)/);
  assert.deepEqual(result.angular.components[1].template, {
    kind: 'external', url: './external.html', range: {startLine: 4, endLine: 4}, analysis: 'unverified',
  });
  assert.equal(result.unknowns.filter((entry) => entry.reason === 'angular_template_unverified').length, 2);
});

test('HttpClient typed lexical constructor properties, fields, parameters and namespace aliases yield literal HTTP references', () => {
  const result = parse(`import {HttpClient as Client} from '@angular/common/http';
import * as Http from '@angular/common/http';
class Api {
  private other!: Http.HttpClient;
  constructor(private readonly http: Client) {}
  load() { return this.http.get<{label:string}>('/read'); }
  update() { return this.other.post(\`/create\`, {label:'x'}); }
  execute() { return this.http.request('patch', '/update'); }
}
function remove(client: Client) { client.delete('/remove'); client.head('/head'); client.options('/options'); client.put('/put', {}); }
`);
  assert.deepEqual(http(result).map(({url, method}) => ({url, method})), [
    {url:'/read', method:'GET'}, {url:'/create', method:'POST'}, {url:'/update', method:'PATCH'},
    {url:'/remove', method:'DELETE'}, {url:'/head', method:'HEAD'}, {url:'/options', method:'OPTIONS'}, {url:'/put', method:'PUT'},
  ]);
  assert.ok(http(result).every((entry) => entry.name === 'angular-http-client'));
  assert.equal(http(result)[0].caller, 'Api.load');
  assert.equal(http(result)[1].caller, 'Api.update');
  assert.equal(result.unknowns.filter((entry) => entry.reason === 'angular_http_runtime_unverified').length, 7);
  assert.equal(result.references.find((entry) => entry.kind === 'call' && entry.receiver === 'this.http').receiverType, 'Client');
});

test('fake HttpClient declarations, wrong imports, type/receiver shadows, inference and computed calls cannot become HTTP edges', () => {
  const result = parse(`import {HttpClient as Client} from '@angular/common/http';
import {HttpClient as WrongClient} from './fake';
import * as Http from '@angular/common/http';
class HttpClient { get(url: string) {} }
class Fake {
  constructor(private http: HttpClient, private wrong: WrongClient) {}
  load() { this.http.get('/fake-class'); this.wrong.get('/fake-module'); }
}
class Real {
  constructor(private http: Client) {}
  load(http: any) { http.get('/shadow'); this.http.get('/real'); }
  computed() { this.http['get']('/computed'); }
}
function shadow<Client>(client: Client) { client.get('/type-shadow'); }
namespace Local {
  export namespace Http { export interface HttpClient {get(url: string): void;} }
  export function use(client: Http.HttpClient) { client.get('/namespace-shadow'); }
}
const client = new HttpClient(); client.get('/inferred-fake');
function alias(real: Client) { const indirect = real; indirect.get('/inferred-alias'); }
`);
  assert.deepEqual(http(result).map(({url}) => url), ['/real']);
  assert.ok(reasons(result).includes('computed_property_call'));
  assert.ok(reasons(result).includes('unresolved_call'));
});

test('dynamic HttpClient URLs/methods and HttpRequest overloads stay explicit; RxJS execution remains unverified', () => {
  const result = parse(`import type {HttpClient} from '@angular/common/http';
function load(http: HttpClient, path: string, verb: string, request: any) {
  http.get(path).pipe(map(value => value)).subscribe();
  http.request(verb, '/known');
  http.request('GET', path);
  http.request(request);
}
`);
  assert.equal(http(result).length, 4);
  assert.ok(http(result).every((entry) => entry.dynamic === true));
  assert.equal(http(result)[0].method, 'GET');
  assert.equal(http(result)[1].url, '/known');
  assert.equal(http(result)[1].method, undefined);
  assert.equal(http(result)[2].url, undefined);
  assert.equal(http(result)[3].url, undefined);
  assert.equal(http(result)[3].method, undefined);
  assert.ok(reasons(result).includes('dynamic_http_url'));
  assert.ok(reasons(result).includes('dynamic_http_method'));
  assert.ok(reasons(result).includes('angular_http_runtime_unverified'));
  assert.ok(result.unknowns.some((entry) => entry.reason === 'unresolved_call' && /subscribe|pipe/.test(entry.detail)));
});

async function angularReport(suite = 'lookup') {
  const fixture = path.join(repository, 'fixtures/angular', suite);
  const rules = JSON.parse(await readFile(path.join(repository, 'fixtures', suite === 'lookup' ? 'rules.json' : 'renamed-rules.json'), 'utf8'));
  return analyze({baseline: {type:'directory', root:path.join(fixture, 'baseline')}, candidate: {type:'directory', root:path.join(fixture, 'candidate')}, rules, asOf:'2026-10-11'});
}
const from = (edge) => edge.fromPath ?? edge.evidence?.path;
const to = (edge) => edge.toPath ?? edge.targetEvidence?.path;

test('Angular consuming the same Spring API change has evidenced direct HTTP and indirect component paths', async () => {
  const report = await angularReport();
  assert.ok(report.changes.some((change) => change.contractChanged && change.after?.path.endsWith('LookupController.java')));
  const edge = report.impact.direct.find((entry) => entry.kind === 'http' && from(entry).endsWith('lookup.service.ts') && to(entry).endsWith('LookupController.java'));
  assert.ok(edge);
  assert.ok(edge.evidence.range && edge.targetEvidence.range);
  assert.ok(report.impact.indirect.some((entry) => entry.path.endsWith('lookup-panel.component.ts')));
  assert.ok(report.impact.indirect.some((entry) => entry.path.endsWith('app.component.ts')));
  const impacted = [...report.impact.direct.map(from), ...report.impact.indirect.map((entry) => entry.path)];
  assert.ok(!impacted.some((entry) => entry.endsWith('billing.component.ts') || entry.endsWith('decoys.ts') || entry.endsWith('dynamic-lookup.service.ts')));
  assert.ok(report.unknowns.some((entry) => entry.reason === 'dynamic_http_url'));
  assert.ok(report.unknowns.some((entry) => entry.reason === 'angular_template_unverified'));
  assert.ok(report.unknowns.some((entry) => entry.reason === 'angular_http_runtime_unverified'));
});

test('equivalent renamed Angular source preserves generic parser and engine detection', async () => {
  const original = await angularReport();
  const renamed = await angularReport('renamed');
  assert.equal(renamed.changes.length, original.changes.length);
  assert.equal(renamed.impact.direct.length, original.impact.direct.length);
  assert.equal(renamed.impact.indirect.length, original.impact.indirect.length);
  assert.equal(renamed.unknowns.length, original.unknowns.length);
  assert.ok(renamed.impact.direct.some((entry) => entry.kind === 'http' && from(entry).endsWith('inventory.service.ts') && to(entry).endsWith('InventoryResource.java')));
  assert.ok(renamed.impact.indirect.some((entry) => entry.path.endsWith('product-panel.component.ts')));
});
