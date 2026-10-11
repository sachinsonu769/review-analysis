import { parse } from 'java-parser';

const SPRING = 'org.springframework.web.bind.annotation';
const SHORTCUTS = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', DeleteMapping: 'DELETE', PatchMapping: 'PATCH' };
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE']);
const CLASS_NODES = new Map([
  ['normalClassDeclaration', 'class'], ['normalInterfaceDeclaration', 'interface'],
  ['recordDeclaration', 'record'], ['enumDeclaration', 'enum'],
  ['annotationInterfaceDeclaration', 'annotation'],
]);
const METHOD_NODES = new Set(['methodDeclaration', 'interfaceMethodDeclaration', 'constructorDeclaration', 'compactConstructorDeclaration']);
const SCOPE_NODES = new Set(['block', 'basicForStatement', 'enhancedForStatement', 'catchClause', 'tryWithResourcesStatement', 'lambdaExpression']);
const isNode = value => value && typeof value === 'object' && value.children;
const child = (node, name) => node?.children?.[name]?.[0];
const children = node => Object.values(node.children).flat().filter(isNode).sort((a, b) => a.location.startOffset - b.location.startOffset);
const range = node => ({ startLine: node.location?.startLine ?? node.startLine, endLine: node.location?.endLine ?? node.endLine });

/** A pure CST adapter. Symbol resolution beyond lexical bindings belongs to the engine. */
export function parseJava(path, text) {
  const result = { language: 'java', declarations: [], references: [], endpoints: [], unknowns: [] };
  let cst;
  try { cst = parse(text); }
  catch (error) {
    const detail = String(error.message).slice(0, 1600);
    const line = Number(detail.match(/errors detected in line: (\d+)/)?.[1]);
    result.unknowns.push({ reason: 'Java parse error', detail, ...(line ? { range: { startLine: line, endLine: line } } : {}) });
    return result;
  }
  const nodes = [], parents = new WeakMap(), classes = new WeakMap(), wrapperClasses = new WeakMap(), methods = new WeakMap();
  const source = node => text.slice(node.location.startOffset, node.location.endOffset + 1);
  const tokens = node => {
    const out = [];
    function visit(n) { for (const group of Object.values(n.children)) for (const entry of group) isNode(entry) ? visit(entry) : out.push(entry); }
    visit(node);
    return out.sort((a, b) => a.startOffset - b.startOffset);
  };
  const compact = node => node ? tokens(node).map(t => t.image).join('') : '';
  function walk(node, parent) {
    if (parent) parents.set(node, parent);
    nodes.push(node);
    for (const next of children(node)) walk(next, node);
  }
  walk(cst);
  function ancestor(node, predicate) {
    for (let parent = parents.get(node); parent; parent = parents.get(parent)) if (predicate(parent)) return parent;
  }
  const enclosingClass = node => classes.get(ancestor(node, n => classes.has(n)));
  function bindingClass(node) {
    for (let current = node; current; current = parents.get(current)) {
      if (classes.has(current)) return classes.get(current);
      if (wrapperClasses.has(current)) return wrapperClasses.get(current);
    }
  }
  const enclosingMethod = node => methods.get(ancestor(node, n => methods.has(n)));
  function unknown(reason, node, detail) {
    result.unknowns.push({ reason, ...(node ? { range: range(node) } : {}), ...(detail ? { detail } : {}) });
  }
  function unsupportedContext(node) {
    return ancestor(node, n => n.name === 'classBody' && ['unqualifiedClassInstanceCreationExpression', 'enumConstant'].includes(parents.get(n)?.name)) ||
      ancestor(node, n => CLASS_NODES.has(n.name) && !classes.has(n));
  }
  const packageNode = nodes.find(n => n.name === 'packageDeclaration');
  const packageName = packageNode ? (packageNode.children.Identifier ?? tokens(child(packageNode, 'packageName') ?? packageNode).filter(t => t.tokenType.name === 'Identifier')).map(t => t.image).join('.') : '';
  const imports = new Map(), wildcardImports = [], staticImports = new Set();
  for (const node of nodes.filter(n => n.name === 'importDeclaration')) {
    const ids = tokens(node).filter(t => t.tokenType.name === 'Identifier').map(t => t.image);
    const qualified = ids.join('.'), wildcard = !!node.children.Star, isStatic = !!node.children.Static;
    result.references.push({ kind: 'import', name: qualified + (wildcard ? '.*' : ''), module: qualified, imported: wildcard ? '*' : ids.at(-1), ...(isStatic ? { static: true } : {}), ...(!wildcard ? { target: qualified } : {}), range: range(node) });
    if (isStatic) staticImports.add(qualified + (wildcard ? '.*' : ''));
    else if (wildcard) wildcardImports.push(qualified);
    else {
      const name = ids.at(-1);
      imports.set(name, [...(imports.get(name) ?? []), qualified]);
    }
    if (wildcard) unknown('Wildcard import requires external symbol resolution', node, qualified + '.*');
  }
  const classList = [], methodList = [], classBySimple = new Map();
  for (const node of nodes.filter(n => CLASS_NODES.has(n.name))) {
    if (unsupportedContext(node)) continue;
    if (ancestor(node, n => METHOD_NODES.has(n.name))) {
      unknown('Local Java type ownership is unsupported', node);
      continue;
    }
    const owner = enclosingClass(node);
    const name = compact(child(node, 'typeIdentifier'));
    const qualified = owner ? `${owner.key}.${name}` : [packageName, name].filter(Boolean).join('.');
    const wrapper = ['classDeclaration', 'interfaceDeclaration'].includes(parents.get(node)?.name) ? parents.get(node) : node;
    const bodyNode = ['classBody', 'interfaceBody', 'recordBody', 'enumBody', 'annotationInterfaceBody'].map(key => child(node, key)).find(Boolean);
    const declaration = { key: qualified, name, kind: CLASS_NODES.get(node.name), signature: text.slice(wrapper.location.startOffset, bodyNode?.location.startOffset ?? node.location.endOffset + 1).trim(), body: source(wrapper), range: range(wrapper), ...(owner ? { owner: owner.key } : {}) };
    const meta = { key: qualified, name, node, wrapper, declaration, parent: owner, fields: new Map(), bindings: [] };
    classes.set(node, meta);
    wrapperClasses.set(wrapper, meta);
    classList.push(meta);
    classBySimple.set(name, [...(classBySimple.get(name) ?? []), meta]);
    result.declarations.push(declaration);
  }
  function isTypeParameter(name, context) {
    for (let node = context; node; node = parents.get(node)) {
      if (!CLASS_NODES.has(node.name) && !METHOD_NODES.has(node.name)) continue;
      const parametersNode = child(node, 'typeParameters') ?? child(child(node, 'methodHeader'), 'typeParameters') ?? child(child(node, 'constructorDeclarator'), 'typeParameters');
      if (parametersNode && nodesWithin(parametersNode).some(n => n.name === 'typeParameter' && compact(child(n, 'typeIdentifier')) === name)) return true;
    }
    return false;
  }
  function lexicalType(name, context) {
    const cls = context ? bindingClass(context) : undefined;
    if (isTypeParameter(name, context)) return undefined;
    if (cls && (name === cls.name || name.startsWith(cls.name + '.'))) return cls.key + name.slice(cls.name.length);
    for (let owner = cls; owner; owner = owner.parent) {
      const nested = classList.filter(c => c.key === `${owner.key}.${name}`);
      if (nested.length === 1) return nested[0].key;
    }
    const local = (classBySimple.get(name) ?? []).filter(c => !c.declaration.owner);
    if (local.length === 1) return local[0].key;
    const imported = imports.get(name);
    return imported?.length === 1 ? imported[0] : undefined;
  }
  function declaredType(typeNode, dimsNode, context) {
    if (!typeNode) return undefined;
    const original = compact(typeNode);
    if (original === 'var' || compact(dimsNode).includes('[') || original.includes('[')) return undefined;
    const type = tokens(typeNode).filter(t => t.tokenType.name === 'Identifier' || t.image === '.');
    // The base reference node owns only its identifiers, so generic arguments cannot become a receiver type.
    const base = nodesWithin(typeNode).find(n => ['unannClassType', 'classType'].includes(n.name));
    const name = base ? (base.children.Identifier ?? []).map(t => t.image).join('.') : type.map(t => t.image).join('');
    if (!name || isTypeParameter(name, context)) return undefined;
    return lexicalType(name, context) ?? name;
  }
  function nodesWithin(node) { const out = []; function visit(n) { out.push(n); for (const next of children(n)) visit(next); } visit(node); return out; }
  function parameters(declarator) {
    return (child(declarator, 'formalParameterList')?.children.formalParameter ?? []).map(parameter => {
      const entry = child(parameter, 'variableParaRegularParameter') ?? child(parameter, 'variableArityParameter');
      const id = child(entry, 'variableDeclaratorId');
      const name = id?.children.Identifier?.[0]?.image ?? entry.children.Identifier?.[0]?.image;
      const typeNode = child(entry, 'unannType');
      return { name, type: entry.children.DotDotDot ? undefined : declaredType(typeNode, child(id, 'dims'), parameter), keyType: compact(typeNode) + compact(child(id, 'dims')) + (entry.children.DotDotDot ? '...' : ''), node: parameter };
    });
  }
  for (const node of nodes.filter(n => METHOD_NODES.has(n.name))) {
    if (unsupportedContext(node)) continue;
    const owner = enclosingClass(node);
    if (!owner) continue;
    const constructor = node.name.includes('Constructor') || node.name === 'constructorDeclaration';
    const header = child(node, 'methodHeader');
    const declarator = child(header, 'methodDeclarator') ?? child(node, 'constructorDeclarator');
    const name = constructor ? owner.name : declarator?.children.Identifier?.[0]?.image;
    if (!name) continue;
    const params = declarator ? parameters(declarator) : [];
    if (node.name === 'compactConstructorDeclaration') {
      unknown('Compact record constructor has implicit parameters', node);
      for (const component of child(child(owner.node, 'recordHeader'), 'recordComponentList')?.children.recordComponent ?? []) params.push({ name: component.children.Identifier?.[0]?.image, keyType: compact(child(component, 'unannType')), node: component });
    }
    const bodyNode = child(node, 'methodBody') ?? child(node, 'constructorBody');
    const declaration = { key: `${owner.key}#${constructor ? '<init>' : name}/${params.length}`, name, kind: constructor ? 'constructor' : 'method', owner: owner.key, arity: params.length, varargs: params.some(p=>p.keyType?.endsWith('...')), signature: text.slice(node.location.startOffset, bodyNode?.location.startOffset ?? node.location.endOffset + 1).trim(), body: source(node), range: range(node) };
    const meta = { node, owner, params, declaration, bindings: [] };
    methods.set(node, meta);
    methodList.push(meta);
    result.declarations.push(declaration);
  }
  const overloadGroups = new Map();
  for (const method of methodList) overloadGroups.set(method.declaration.key, [...(overloadGroups.get(method.declaration.key) ?? []), method]);
  for (const group of overloadGroups.values()) if (group.length > 1) for (const method of group) method.declaration.key += `(${method.params.map(p => p.keyType).join(',')})`;
  for (const node of nodes.filter(n => ['fieldDeclaration', 'constantDeclaration', 'recordComponent'].includes(n.name))) {
    if (unsupportedContext(node)) continue;
    const owner = enclosingClass(node);
    if (!owner) continue;
    const typeNode = child(node, 'unannType');
    const entries = node.name === 'recordComponent' ? [node] : child(node, 'variableDeclaratorList')?.children.variableDeclarator ?? [];
    for (const entry of entries) {
      const id = child(entry, 'variableDeclaratorId');
      const vararg = child(entry, 'variableArityRecordComponent');
      const name = id?.children.Identifier?.[0]?.image ?? entry.children.Identifier?.[0]?.image ?? vararg?.children.Identifier?.[0]?.image;
      const type = vararg ? undefined : declaredType(typeNode, child(id, 'dims'), node);
      owner.fields.set(name, type);
      const signature = node.name === 'recordComponent' ? source(node) : `${text.slice(node.location.startOffset, typeNode.location.endOffset + 1).trim()} ${compact(id)}`;
      result.declarations.push({ key: `${owner.key}#${name}`, name, kind: node.name === 'recordComponent' ? 'component' : 'field', owner: owner.key, signature, body: source(node), range: range(node) });
    }
  }
  function addBinding(method, name, type, scope, offset) {
    if (method && name && scope) method.bindings.push({ name, type, start: scope.location.startOffset, end: scope.location.endOffset, offset });
  }
  for (const method of methodList) for (const param of method.params) addBinding(method, param.name, param.type, method.node, method.node.location.startOffset);
  for (const node of nodes.filter(n => n.name === 'localVariableDeclaration')) {
    if (unsupportedContext(node)) continue;
    const method = enclosingMethod(node) ?? enclosingClass(node);
    const pattern = ancestor(node, n => n.name === 'typePattern');
    const loop = ancestor(node, n => n.name === 'enhancedForStatement');
    const resource = ancestor(node, n => n.name === 'resource');
    const tryNode = resource && ancestor(resource, n => n.name === 'tryWithResourcesStatement');
    const resourceScope = tryNode && { location: { startOffset: child(tryNode, 'resourceSpecification').location.startOffset, endOffset: child(tryNode, 'block').location.endOffset } };
    const scope = pattern ? method?.node : loop && ancestor(node, n => SCOPE_NODES.has(n.name)) === loop ? child(loop, 'statement') : resourceScope ?? ancestor(node, n => SCOPE_NODES.has(n.name));
    const typeNode = child(child(node, 'localVariableType'), 'unannType');
    for (const entry of child(node, 'variableDeclaratorList')?.children.variableDeclarator ?? []) {
      const id = child(entry, 'variableDeclaratorId'), name = id.children.Identifier?.[0]?.image;
      const type = pattern ? undefined : declaredType(typeNode, child(id, 'dims'), node);
      addBinding(method, name, type, scope, pattern ? method?.node.location.startOffset : entry.location.startOffset);
      if (!type) unknown('Java local receiver type is not inferred', node, compact(child(node, 'localVariableType')));
    }
  }
  for (const node of nodes.filter(n => ['enhancedForStatement', 'catchFormalParameter', 'resource'].includes(n.name))) {
    const method = enclosingMethod(node) ?? enclosingClass(node), id = child(node, 'variableDeclaratorId');
    if (!id) continue;
    const scope = node.name === 'enhancedForStatement' ? node : ancestor(node, n => n.name === 'catchClause' || n.name === 'tryWithResourcesStatement');
    addBinding(method, id.children.Identifier?.[0]?.image, declaredType(child(node, 'unannType'), child(id, 'dims'), node), scope, node.location.startOffset);
  }
  // Lambda parameters shadow outer fields/locals even when their inferred type is unavailable.
  for (const node of nodes.filter(n => n.name === 'lambdaExpression')) {
    const parameterNode = child(node, 'lambdaParameters');
    if (!parameterNode) continue;
    const method = enclosingMethod(node) ?? enclosingClass(node);
    const ids = nodesWithin(parameterNode).filter(n => ['variableDeclaratorId', 'conciseLambdaParameter', 'variableArityParameter'].includes(n.name)).flatMap(n => n.children.Identifier ?? []);
    if (!ids.length && parameterNode.children.Identifier) ids.push(...parameterNode.children.Identifier);
    for (const id of ids) addBinding(method, id.image, undefined, node, node.location.startOffset);
    unknown('Lambda parameter receiver types are not inferred', node);
  }
  function receiverType(receiver, node, method, owner) {
    if (receiver === 'this') return owner?.key;
    if (receiver.startsWith('this.') && receiver.split('.').length === 2) return owner?.fields.get(receiver.slice(5));
    if (receiver.includes('.') || receiver === 'super') return undefined;
    const offset = node.location.startOffset;
    const bindings = [...(method?.bindings ?? []), ...(owner?.bindings ?? [])].filter(binding => binding.name === receiver && binding.offset <= offset && binding.start <= offset && offset <= binding.end).sort((a, b) => (a.end - a.start) - (b.end - b.start) || b.offset - a.offset);
    if (bindings.length) return bindings[0].type;
    if (owner?.fields.has(receiver)) return owner.fields.get(receiver);
    return lexicalType(receiver, node);
  }
  for (const node of nodes.filter(n => ['unannClassType', 'classType', 'classOrInterfaceTypeToInstantiate', 'annotation'].includes(n.name))) {
    if (unsupportedContext(node)) continue;
    const targetNode = node.name === 'annotation' ? child(node, 'typeName') : node;
    const name = (targetNode.children.Identifier ?? []).map(t => t.image).join('.');
    if (!name) continue;
    const generic = isTypeParameter(name, node);
    const target = lexicalType(name, node);
    result.references.push({ kind: 'type', name, ...(target ? { target } : {}), ...(generic ? { dynamic: true } : {}), ...(bindingClass(node) ? { owner: bindingClass(node).key } : {}), range: range(targetNode) });
    if (generic) unknown('Generic Java type requires bound and substitution resolution', node, name);
  }
  for (const node of nodes.filter(n => n.name === 'primary')) {
    if (unsupportedContext(node)) continue;
    const method = enclosingMethod(node), owner = enclosingClass(node);
    const prefix = child(node, 'primaryPrefix');
    const fqn = child(prefix, 'fqnOrRefType');
    const parts = fqn ? [child(fqn, 'fqnOrRefTypePartFirst'), ...(fqn.children.fqnOrRefTypePartRest ?? [])].map(part => child(part, 'fqnOrRefTypePartCommon')).map(common => common?.children.Identifier?.[0]?.image ?? common?.children.Super?.[0]?.image).filter(Boolean) : prefix.children.This ? ['this'] : [];
    let expression = parts.join('.'), complex = !parts.length;
    for (const suffix of node.children.primarySuffix ?? []) {
      if (suffix.children.Identifier) expression += (expression ? '.' : '') + suffix.children.Identifier[0].image;
      else if (suffix.children.This) { expression += '.this'; complex = true; }
      else if (child(suffix, 'arrayAccessSuffix')) { expression += source(suffix); complex = true; }
      const invocation = child(suffix, 'methodInvocationSuffix');
      if (!invocation) continue;
      const split = expression.lastIndexOf('.');
      const name = split >= 0 ? expression.slice(split + 1) : expression;
      const receiver = split >= 0 ? expression.slice(0, split) : undefined;
      const arity = child(invocation, 'argumentList')?.children.expression?.length ?? 0;
      const inferred = receiver && !complex ? receiverType(receiver, node, method, owner) : !receiver && !complex ? owner?.key : undefined;
      const candidates = !complex && inferred ? methodList.filter(candidate => candidate.owner.key === inferred && candidate.declaration.kind === 'method' && candidate.declaration.name === name && candidate.params.length === arity) : [];
      // A call through another instance may dispatch to an override. Only current-instance calls have lexical targets.
      const target = candidates.length === 1 && (!receiver || receiver === 'this') ? candidates[0].declaration.key : undefined;
      const ref = { kind: 'call', name: name || '<expression>', arity, ...(receiver ? { receiver } : {}), ...(inferred ? { receiverType: inferred } : {}), ...(target ? { target } : {}), ...(owner ? { owner: owner.key } : {}), ...(method ? { caller: method.declaration.key } : {}), ...((complex || receiver && !inferred) ? { dynamic: true } : {}), range: { startLine: node.location.startLine, endLine: invocation.location.endLine } };
      result.references.push(ref);
      if (ref.dynamic) unknown('Java call receiver is unresolved', invocation, receiver ?? source(prefix));
      if (candidates.length > 1) unknown('Java overload requires argument type resolution', invocation, `${name}/${arity}`);
      expression += source(invocation);
      complex = true;
    }
  }
  for (const node of nodes.filter(n => n.name === 'methodReferenceSuffix')) unknown('Java method reference requires type resolution', node, source(node));
  for (const node of nodes.filter(n => ['unqualifiedClassInstanceCreationExpression', 'enumConstant'].includes(n.name) && child(n, 'classBody'))) unknown('Anonymous Java class members are unsupported', node);

  function annotations(node) {
    return children(node).filter(n => /Modifier$/.test(n.name)).flatMap(n => n.children.annotation ?? []).concat(node.children.annotation ?? []);
  }
  function mappingAnnotation(annotation) {
    const fullName = compact(child(annotation, 'typeName')), name = fullName.split('.').at(-1);
    if (name !== 'RequestMapping' && !SHORTCUTS[name]) return undefined;
    const qualified = fullName.includes('.') ? fullName : imports.get(name)?.length === 1 ? imports.get(name)[0] : wildcardImports.length === 1 && wildcardImports[0] === SPRING ? `${SPRING}.${name}` : undefined;
    if (qualified !== `${SPRING}.${name}` || classBySimple.has(name)) { unknown('Mapping annotation is not verified as a Spring annotation', annotation, fullName); return undefined; }
    return name;
  }
  function annotationValues(annotation) {
    const attrs = new Map();
    if (child(annotation, 'elementValue')) attrs.set('value', child(annotation, 'elementValue'));
    for (const pair of child(annotation, 'elementValuePairList')?.children.elementValuePair ?? []) attrs.set(pair.children.Identifier[0].image, child(pair, 'elementValue'));
    return attrs;
  }
  function literalValues(node, decode) {
    const array = child(node, 'elementValueArrayInitializer');
    if (array) {
      const values = child(array, 'elementValueList')?.children.elementValue ?? [];
      const decoded = values.map(value => literalValues(value, decode));
      return decoded.some(value => value === undefined) ? undefined : decoded.flat();
    }
    return decode(tokens(node), node);
  }
  function stringLiteral(ts) {
    if (ts.length !== 1 || ts[0].tokenType.name !== 'StringLiteral') return undefined;
    const value = decodeJavaString(ts[0].image);
    return value === undefined || value.includes('${') || value.includes('#{') ? undefined : [value];
  }
  function requestMethods(ts, node) {
    const value = ts.map(token => token.image).join(''), method = value.split('.').at(-1);
    const boundType = lexicalType('RequestMethod', node) ?? (wildcardImports.length === 1 && wildcardImports[0] === SPRING ? `${SPRING}.RequestMethod` : undefined);
    const owner = bindingClass(node);
    let shadowedConstant = false;
    for (let cls = owner; cls; cls = cls.parent) if (cls.fields.has(method)) shadowedConstant = true;
    const explicit = value === `${SPRING}.RequestMethod.${method}` || value === `RequestMethod.${method}` && boundType === `${SPRING}.RequestMethod` || value === method && !shadowedConstant && (staticImports.has(`${SPRING}.RequestMethod.${method}`) || staticImports.has(`${SPRING}.RequestMethod.*`));
    return explicit && HTTP_METHODS.has(method) ? [method] : undefined;
  }
  function mapping(node) {
    const found = annotations(node).map(annotation => ({ annotation, name: mappingAnnotation(annotation) })).filter(entry => entry.name);
    if (!found.length) return undefined;
    if (found.length > 1) { unknown('Multiple Spring mapping annotations are ambiguous', node); return { valid: false }; }
    const { annotation, name } = found[0], attrs = annotationValues(annotation);
    if (attrs.has('path') && attrs.has('value')) { unknown('Spring path and value aliases cannot both be resolved conservatively', annotation); return { valid: false }; }
    const paths = attrs.has('path') || attrs.has('value') ? literalValues(attrs.get('path') ?? attrs.get('value'), stringLiteral) : [''];
    const methods = SHORTCUTS[name] ? [SHORTCUTS[name]] : attrs.has('method') ? literalValues(attrs.get('method'), requestMethods) : ['*'];
    if (!paths || !methods) { unknown('Dynamic Spring mapping requires configuration or constant evaluation', annotation, source(annotation)); return { valid: false }; }
    for (const attr of attrs.keys()) if (!['value', 'path', 'method'].includes(attr)) unknown('Spring mapping qualifier is not modeled', annotation, attr);
    return { valid: true, paths: paths.length ? paths : [''], methods: methods.length ? methods : ['*'], annotation };
  }
  const classMappings = new Map(classList.map(cls => [cls.key, mapping(cls.wrapper)]));
  for (const method of methodList.filter(method => method.declaration.kind === 'method')) {
    const mapped = mapping(method.node);
    if (!mapped?.valid) continue;
    const base = classMappings.get(method.owner.key) ?? { valid: true, paths: [''], methods: ['*'] };
    if (!base.valid) { unknown('Method mapping depends on an unresolved class mapping', method.node); continue; }
    const verbs = mapped.methods.includes('*') ? base.methods : base.methods.includes('*') ? mapped.methods : [...new Set([...base.methods, ...mapped.methods])];
    for (const prefix of base.paths) for (const suffix of mapped.paths) for (const verb of verbs) {
      if (prefix.includes('*') && suffix) { unknown('Spring wildcard path composition is unsupported', mapped.annotation, `${prefix} + ${suffix}`); continue; }
      const url = joinRoute(prefix, suffix);
      result.endpoints.push({ name: method.declaration.name, declarationKey: method.declaration.key, method: verb, url, range: range(mapped.annotation) });
      result.references.push({ kind: 'http', method: verb, url, owner: method.owner.key, caller: method.declaration.key, range: range(mapped.annotation) });
    }
  }
  result.declarations.sort((a, b) => a.range.startLine - b.range.startLine || a.key.localeCompare(b.key));
  return result;
}

function joinRoute(prefix, suffix) {
  const combined = !prefix ? suffix : !suffix ? prefix : prefix.replace(/\/$/, '') + '/' + suffix.replace(/^\//, '');
  return combined.startsWith('/') ? combined : '/' + combined;
}

function decodeJavaString(literal) {
  const value = literal.slice(1, -1), escapes = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', "'": "'", '\\': '\\', s: ' ' };
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') { out += value[i]; continue; }
    const escaped = value[++i];
    if (Object.hasOwn(escapes, escaped)) out += escapes[escaped];
    else if (escaped === 'u') {
      while (value[i + 1] === 'u') i++;
      const hex = value.slice(i + 1, i + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return undefined;
      out += String.fromCharCode(parseInt(hex, 16)); i += 4;
    } else if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      const maximum = /[0-3]/.test(escaped) ? 3 : 2;
      while (octal.length < maximum && /[0-7]/.test(value[i + 1] ?? 'x')) octal += value[++i];
      out += String.fromCharCode(parseInt(octal, 8));
    } else return undefined;
  }
  return out;
}
