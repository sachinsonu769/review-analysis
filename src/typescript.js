import ts from 'typescript';

/** Parse one supplied source file. The virtual host never accesses disk or libraries. */
export function parseTypeScript(path, text) {
  const scriptKind = /\.tsx$/i.test(path) ? ts.ScriptKind.TSX
    : /\.jsx$/i.test(path) ? ts.ScriptKind.JSX
      : /\.[cm]?js$/i.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind);
  const canonical = (name) => name.replaceAll('\\', '/').replace(/^\/+/, '');
  const sameFile = (name) => canonical(name) === canonical(path);
  const host = {
    getSourceFile: (name) => sameFile(name) ? source : undefined,
    getDefaultLibFileName: () => '__no_lib__.d.ts',
    writeFile() {}, getCurrentDirectory: () => '/', getDirectories: () => [],
    fileExists: sameFile, readFile: (name) => sameFile(name) ? text : undefined,
    getCanonicalFileName: (name) => name, useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n', resolveModuleNames: (names) => names.map(() => undefined),
  };
  const program = ts.createProgram([path], {
    noLib: true, noResolve: true, allowJs: true, target: ts.ScriptTarget.Latest,
    jsx: ts.JsxEmit.Preserve,
  }, host);
  const checker = program.getTypeChecker();
  const declarations = [];
  const references = [];
  const unknowns = [];
  const declarationsByKey = new Map();
  const declarationKeys = new Map();
  const importsBySymbol = new Map();
  const angular = { components: [], injectables: [], modules: [] };
  const range = (node) => {
    const start = node.getStart(source);
    return {
      startLine: source.getLineAndCharacterOfPosition(start).line + 1,
      endLine: source.getLineAndCharacterOfPosition(Math.max(start, node.end - 1)).line + 1,
    };
  };
  const unknown = (reason, node, detail) => {
    unknowns.push({ reason, ...(node ? { range: range(node) } : {}), ...(detail ? { detail } : {}) });
  };
  for (const diagnostic of source.parseDiagnostics) {
    const start = diagnostic.start ?? 0;
    unknowns.push({
      reason: 'parse_diagnostic',
      range: {
        startLine: source.getLineAndCharacterOfPosition(start).line + 1,
        endLine: source.getLineAndCharacterOfPosition(Math.min(text.length, start + Math.max(0, (diagnostic.length ?? 1) - 1))).line + 1,
      },
      detail: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    });
  }

  const nodeText = (node) => node.getText(source);
  const nameText = (name) => name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) ? name.text : undefined;
  const modifiersText = (node) => node.modifiers?.map(nodeText).join(' ') ?? '';
  const sourceHeader = (node) => node.body ? text.slice(node.getStart(source), node.body.getStart(source)).trim() : nodeText(node);
  const variableSignature = (node) => {
    const list = node.parent;
    const statement = ts.isVariableDeclarationList(list) ? list.parent : undefined;
    const keyword = ts.isVariableDeclarationList(list)
      ? (list.flags & ts.NodeFlags.Const ? 'const' : list.flags & ts.NodeFlags.Let ? 'let' : 'var') : 'variable';
    const prefix = statement ? modifiersText(statement) : '';
    let signature = `${prefix ? prefix + ' ' : ''}${keyword} ${nodeText(node.name)}${node.type ? ': ' + nodeText(node.type) : ''}`;
    const initializer = unwrap(node.initializer);
    if (!node.type && initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
      signature += ' = ' + sourceHeader(initializer);
    }
    return signature;
  };
  const memberSignature = (node) => {
    if (node.body) return sourceHeader(node);
    if (node.initializer) return text.slice(node.getStart(source), node.initializer.getStart(source)).replace(/\s*=\s*$/, '').trim();
    return nodeText(node);
  };
  const memberName = (node, ordinal) => {
    if (ts.isConstructorDeclaration(node)) return 'constructor';
    if (ts.isCallSignatureDeclaration(node)) return '$call' + ordinal;
    if (ts.isConstructSignatureDeclaration(node)) return '$construct' + ordinal;
    if (ts.isIndexSignatureDeclaration(node)) return '$index' + ordinal;
    return nameText(node.name);
  };
  const memberKind = (node) => {
    if (ts.isConstructorDeclaration(node)) return 'constructor';
    if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return 'method';
    if (ts.isGetAccessorDeclaration(node)) return 'getter';
    if (ts.isSetAccessorDeclaration(node)) return 'setter';
    if (ts.isCallSignatureDeclaration(node)) return 'call-signature';
    if (ts.isConstructSignatureDeclaration(node)) return 'construct-signature';
    if (ts.isIndexSignatureDeclaration(node)) return 'index-signature';
    return 'property';
  };
  const addDeclaration = (node, key, name, kind, signature, owner) => {
    declarationKeys.set(node, key);
    const entry = { key, name, kind, signature, body: nodeText(node), range: range(node), ...(owner ? { owner } : {}) };
    // Overloads/accessor pairs share one stable name-based identity and all signatures.
    const previous = declarationsByKey.get(key);
    if (previous) {
      previous.signature += '\n' + signature;
      previous.body += '\n' + entry.body;
      previous.range.endLine = entry.range.endLine;
    } else {
      declarations.push(entry);
      declarationsByKey.set(key, entry);
    }
  };
  function bindings(name) {
    if (ts.isIdentifier(name)) return [name];
    const names = [];
    for (const element of name.elements ?? []) {
      if (ts.isBindingElement(element)) names.push(...bindings(element.name));
    }
    return names;
  }
  function addMembers(container, owner) {
    const ordinals = new Map();
    for (const member of container.members ?? []) {
      const category = ts.SyntaxKind[member.kind];
      const ordinal = (ordinals.get(category) ?? 0) + 1;
      ordinals.set(category, ordinal);
      const name = memberName(member, ordinal);
      if (!name) {
        unknown(ts.isClassStaticBlockDeclaration(member) ? 'class_static_block' : 'computed_declaration_name', member, nodeText(member.name ?? member));
        continue;
      }
      addDeclaration(member, `${owner}.${name}`, name, memberKind(member), memberSignature(member), owner);
      if (ts.isConstructorDeclaration(member)) {
        for (const parameter of member.parameters) {
          if (ts.isParameterPropertyDeclaration(parameter, member) && ts.isIdentifier(parameter.name)) {
            addDeclaration(parameter, `${owner}.${parameter.name.text}`, parameter.name.text, 'property', memberSignature(parameter), owner);
          }
        }
      }
    }
  }
  function collectStatements(statements, prefix = '') {
    for (const statement of statements) {
      if (ts.isFunctionDeclaration(statement)) {
        if (!statement.name) { unknown('anonymous_default_export', statement); continue; }
        addDeclaration(statement, prefix + statement.name.text, statement.name.text, 'function', sourceHeader(statement), prefix.slice(0, -1));
      } else if (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
        if (!statement.name) { unknown('anonymous_default_export', statement); continue; }
        const key = prefix + statement.name.text;
        const open = statement.getChildren(source).find((child) => child.kind === ts.SyntaxKind.OpenBraceToken)?.getStart(source);
        const header = text.slice(statement.getStart(source), open ?? statement.end).trim();
        const signature = header + ' {\n' + statement.members.map(memberSignature).join('\n') + '\n}';
        addDeclaration(statement, key, statement.name.text, ts.isClassDeclaration(statement) ? 'class' : 'interface', signature, prefix.slice(0, -1));
        addMembers(statement, key);
      } else if (ts.isTypeAliasDeclaration(statement)) {
        const key = prefix + statement.name.text;
        addDeclaration(statement, key, statement.name.text, 'type', nodeText(statement), prefix.slice(0, -1));
        if (ts.isTypeLiteralNode(statement.type)) addMembers(statement.type, key);
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          for (const binding of bindings(declaration.name)) {
            const key = prefix + binding.text;
            addDeclaration(declaration, key, binding.text, 'variable', variableSignature(declaration), prefix.slice(0, -1));
            // Each destructured name must link to its own binding, not to the last name.
            declarationKeys.set(binding.parent, key);
          }
          if (!ts.isIdentifier(declaration.name)) declarationKeys.delete(declaration);
        }
      } else if (ts.isEnumDeclaration(statement)) {
        const key = prefix + statement.name.text;
        addDeclaration(statement, key, statement.name.text, 'enum', nodeText(statement), prefix.slice(0, -1));
        for (const member of statement.members) {
          const name = nameText(member.name);
          if (name) addDeclaration(member, `${key}.${name}`, name, 'enum-member', nodeText(member), key);
          else unknown('computed_declaration_name', member);
        }
      } else if (ts.isModuleDeclaration(statement)) {
        const name = nameText(statement.name);
        if (!name) { unknown('unsupported_namespace', statement); continue; }
        const key = prefix + name;
        addDeclaration(statement, key, name, 'namespace', `${modifiersText(statement)} namespace ${name}`.trim(), prefix.slice(0, -1));
        if (statement.body && ts.isModuleBlock(statement.body)) collectStatements(statement.body.statements, key + '.');
        else unknown('unsupported_namespace', statement);
      } else if (ts.isExportAssignment(statement)) {
        unknown('export_expression', statement, 'Anonymous/default expressions have no stable named declaration contract.');
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
        unknown('reexport_requires_module_resolution', statement, nodeText(statement.moduleSpecifier));
      } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)
        && statement.exportClause.elements.some((element) => element.propertyName && element.propertyName.text !== element.name.text)) {
        unknown('export_alias_requires_export_resolution', statement, 'Local export aliases are not additional declaration identities.');
      }
    }
  }
  collectStatements(source.statements);

  function importBinding(name, module, imported, typeOnly) {
    const symbol = checker.getSymbolAtLocation(name);
    const entry = { module, imported, typeOnly };
    if (symbol) importsBySymbol.set(symbol, entry);
    references.push({ kind: 'import', name: name.text, module, imported, range: range(name) });
  }
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const module = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : nodeText(statement.moduleSpecifier);
      const clause = statement.importClause;
      if (!clause) { references.push({ kind: 'import', module, range: range(statement) }); continue; }
      if (clause.name) importBinding(clause.name, module, 'default', clause.isTypeOnly);
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) importBinding(clause.namedBindings.name, module, '*', clause.isTypeOnly);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) importBinding(element.name, module, (element.propertyName ?? element.name).text, clause.isTypeOnly || element.isTypeOnly);
      }
    } else if (ts.isImportEqualsDeclaration(statement)) {
      unknown('import_equals_requires_module_resolution', statement, nodeText(statement));
    }
  }

  function symbolAt(node) { return node ? checker.getSymbolAtLocation(node) : undefined; }
  function hasSourceBinding(node) { return (symbolAt(node)?.declarations?.length ?? 0) > 0; }
  function localTarget(node) {
    const symbol = symbolAt(node);
    if (!symbol || importsBySymbol.has(symbol)) return undefined;
    const keys = new Set((symbol.declarations ?? []).map((declaration) => declarationKeys.get(declaration)).filter(Boolean));
    return keys.size === 1 ? [...keys][0] : undefined;
  }
  function importedAt(node) {
    if (!node) return undefined;
    if (ts.isIdentifier(node)) return importsBySymbol.get(symbolAt(node));
    if (ts.isPropertyAccessExpression(node)) {
      const receiver = importedAt(unwrap(node.expression));
      if (receiver?.imported === '*') return { ...receiver, imported: node.name.text };
    }
    return undefined;
  }
  function importedTypeAt(node) {
    if (!node || !ts.isTypeReferenceNode(node)) return undefined;
    const name = node.typeName;
    if (ts.isIdentifier(name)) return importedAt(name);
    if (ts.isQualifiedName(name) && ts.isIdentifier(name.left)) {
      const imported = importedAt(name.left);
      if (imported?.imported === '*') return { ...imported, imported: name.right.text };
    }
    return undefined;
  }
  function callerFor(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (declarationKeys.has(parent)) return declarationKeys.get(parent);
      // A nested function has its own caller, even if its contract is not top-level.
      if (ts.isFunctionLike(parent) && parent.name) return nodeText(parent.name);
    }
    return undefined;
  }
  function receiverType(node) {
    const symbol = symbolAt(node);
    for (const declaration of symbol?.declarations ?? []) {
      if (declaration.type) return nodeText(declaration.type);
      const initializer = unwrap(declaration.initializer);
      if (initializer && ts.isNewExpression(initializer)) return nodeText(initializer.expression);
    }
    return undefined;
  }
  function literal(node) {
    node = unwrap(node);
    return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  }
  function options(node, anyUnsupported = false) {
    node = unwrap(node);
    if (!node) return { properties: new Map(), uncertain: false };
    if (!ts.isObjectLiteralExpression(node)) return { properties: new Map(), uncertain: true };
    const properties = new Map();
    let uncertain = false;
    for (const property of node.properties) {
      const name = nameText(property.name);
      if (!name || ts.isSpreadAssignment(property)) { uncertain = true; continue; }
      if (ts.isPropertyAssignment(property)) properties.set(name, property.initializer);
      else if (ts.isShorthandPropertyAssignment(property)) properties.set(name, property.name);
      else if (anyUnsupported || name === 'method' || name === 'url') { properties.set(name, property); uncertain = true; }
    }
    return { properties, uncertain };
  }
  function angularDependency(node, owner, field) {
    node = unwrap(node);
    if (!node || (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node))) {
      unknown('angular_dynamic_metadata', node, `${field} dependencies require direct identifiers or namespace members.`);
      return undefined;
    }
    const target = localTarget(ts.isPropertyAccessExpression(node) ? node.name : node);
    const imported = importedAt(node);
    const dependency = { name: nodeText(node), ...(target ? { target } : {}),
      ...(imported ? { module: imported.module, imported: imported.imported } : {}), range: range(node) };
    if (!target && !imported) unknown('angular_unresolved_metadata_dependency', node, nodeText(node));
    references.push({ kind: 'type', ...dependency, caller: owner, framework: 'angular', metadata: field });
    return dependency;
  }
  function angularMetadata(node) {
    if (!ts.isClassDeclaration(node) || !declarationKeys.has(node)) return;
    const owner = declarationKeys.get(node);
    const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
    for (const decorator of decorators) {
      const expression = unwrap(decorator.expression);
      if (!expression || !ts.isCallExpression(expression)) continue;
      const imported = importedAt(unwrap(expression.expression));
      if (!imported || imported.typeOnly || imported.module !== '@angular/core'
        || !['Component', 'Injectable', 'NgModule'].includes(imported.imported)) continue;
      const group = { Component: 'components', Injectable: 'injectables', NgModule: 'modules' }[imported.imported];
      const fact = { declarationKey: owner, range: range(decorator) };
      angular[group].push(fact);
      const config = options(expression.arguments[0], true);
      if (config.uncertain || (imported.imported !== 'Injectable' && !expression.arguments[0])) {
        unknown('angular_dynamic_metadata', decorator, 'Angular metadata requires a direct object literal without spreads or computed keys.');
        continue;
      }
      for (const field of imported.imported === 'Component' ? ['selector'] : imported.imported === 'Injectable' ? ['providedIn'] : []) {
        const value = config.properties.get(field);
        if (!value) continue;
        const valueLiteral = literal(value);
        if (valueLiteral !== undefined) fact[field] = valueLiteral;
        else if (field === 'providedIn' && unwrap(value).kind === ts.SyntaxKind.NullKeyword) fact[field] = null;
        else unknown('angular_dynamic_metadata', value, `${field} is not a direct literal.`);
      }
      if (imported.imported === 'Component' && config.properties.has('standalone')) {
        const value = unwrap(config.properties.get('standalone'));
        if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) fact.standalone = value.kind === ts.SyntaxKind.TrueKeyword;
        else unknown('angular_dynamic_metadata', value, 'standalone is not a direct boolean literal.');
      }
      const fields = imported.imported === 'Component' ? ['imports', 'providers', 'viewProviders']
        : imported.imported === 'NgModule' ? ['imports', 'declarations', 'exports', 'providers', 'bootstrap'] : [];
      for (const field of fields) {
        const value = unwrap(config.properties.get(field));
        if (!value) continue;
        if (!ts.isArrayLiteralExpression(value)) {
          unknown('angular_dynamic_metadata', value, `${field} requires a direct array literal.`);
          continue;
        }
        fact[field] = value.elements.map((element) => angularDependency(element, owner, field)).filter(Boolean);
      }
      if (imported.imported !== 'Component') continue;
      const inline = config.properties.get('template');
      const external = config.properties.get('templateUrl');
      if (inline && external) {
        unknown('angular_template_unverified', decorator, 'Both template and templateUrl are supplied; template selection is not evaluated.');
        continue;
      }
      const template = inline ?? external;
      if (template) {
        const value = literal(template);
        if (value !== undefined) {
          fact.template = { kind: inline ? 'inline' : 'external', ...(inline ? { text: value } : { url: value }), range: range(template), analysis: 'unverified' };
        }
        unknown('angular_template_unverified', template, inline
          ? 'Inline template text is captured without parsing Angular bindings, selectors or control flow; metadata imports are static dependency approximations.'
          : 'External template content is not loaded; template bindings, selectors and control flow remain unverified.');
      }
    }
  }
  function angularHttpReceiver(node) {
    // Resolve the written annotation at its declaration, not a same-spelled type
    // or receiver at the call site. External definitions and inference stay off.
    const declarations = symbolAt(node)?.declarations ?? [];
    return declarations.length > 0 && declarations.every((declaration) => {
      const imported = importedTypeAt(declaration.type);
      return imported?.module === '@angular/common/http' && imported.imported === 'HttpClient';
    });
  }
  function httpInfo(callee, args) {
    const imported = importedAt(callee);
    const globalFetch = ts.isIdentifier(callee) && callee.text === 'fetch' && !hasSourceBinding(callee);
    const memberFetch = ts.isPropertyAccessExpression(callee) && callee.name.text === 'fetch'
      && ts.isIdentifier(callee.expression) && ['globalThis', 'window', 'self'].includes(callee.expression.text) && !hasSourceBinding(callee.expression);
    const importedFetch = imported && !imported.typeOnly && (
      (['node-fetch', 'cross-fetch', 'isomorphic-fetch'].includes(imported.module) && imported.imported === 'default')
      || (['undici', 'cross-fetch'].includes(imported.module) && imported.imported === 'fetch')
    );
    if (globalFetch || memberFetch || importedFetch) {
      const config = options(args[1]);
      const methodNode = config.properties.get('method');
      return { url: literal(args[0]), method: config.uncertain ? undefined : methodNode ? literal(methodNode)?.toUpperCase() : 'GET', client: 'fetch' };
    }
    const axios = (binding) => binding?.module === 'axios' && !binding.typeOnly && ['default', '*'].includes(binding.imported);
    if (axios(imported)) {
      const first = unwrap(args[0]);
      if (!first || (!ts.isObjectLiteralExpression(first) && literal(first) === undefined && args.length < 2)) {
        // One dynamic argument may be an entire config object, not a URL with GET.
        return { url: undefined, method: undefined, client: 'axios' };
      }
      const config = options(first && ts.isObjectLiteralExpression(first) ? first : args[1]);
      const methodNode = config.properties.get('method');
      return { url: config.uncertain && first && ts.isObjectLiteralExpression(first) ? undefined : first && ts.isObjectLiteralExpression(first) ? literal(config.properties.get('url')) : literal(first), method: config.uncertain ? undefined : methodNode ? literal(methodNode)?.toUpperCase() : 'GET', client: 'axios' };
    }
    if (ts.isPropertyAccessExpression(callee) && axios(importedAt(unwrap(callee.expression)))) {
      const verb = callee.name.text.toLowerCase();
      if (['get', 'delete', 'head', 'options', 'post', 'put', 'patch'].includes(verb)) return { url: literal(args[0]), method: verb.toUpperCase(), client: 'axios' };
      if (verb === 'request') {
        const config = options(args[0]);
        const methodNode = config.properties.get('method');
        return { url: config.uncertain ? undefined : literal(config.properties.get('url')), method: config.uncertain ? undefined : methodNode ? literal(methodNode)?.toUpperCase() : 'GET', client: 'axios' };
      }
    }
    if (ts.isPropertyAccessExpression(callee) && angularHttpReceiver(unwrap(callee.expression))) {
      const verb = callee.name.text;
      if (['get', 'delete', 'head', 'options', 'post', 'put', 'patch'].includes(verb)) {
        return { url: literal(args[0]), method: verb.toUpperCase(), client: 'angular-http-client' };
      }
      if (verb === 'request') {
        // request(HttpRequest) has no method/URL literals at these argument slots.
        return { url: literal(args[1]), method: args.length >= 2 ? literal(args[0])?.toUpperCase() : undefined, client: 'angular-http-client', urlIndex: 1 };
      }
    }
    return undefined;
  }
  function visit(node) {
    angularMetadata(node);
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const caller = callerFor(node);
      const entry = { kind: 'call', arity: node.arguments.length, range: range(node), ...(caller ? { caller } : {}) };
      let dynamicScope=false;
      for(let parent=node.parent;parent;parent=parent.parent)if(ts.isWithStatement(parent)&&node.getStart(source)>=parent.statement.getStart(source))dynamicScope=true;
      if (ts.isIdentifier(callee)) entry.name = callee.text;
      else if (ts.isPropertyAccessExpression(callee)) {
        entry.name = callee.name.text;
        entry.receiver = nodeText(callee.expression);
        const type = receiverType(unwrap(callee.expression));
        if (type) entry.receiverType = type;
      } else {
        entry.name = nodeText(callee);
        entry.dynamic = true;
      }
      if(dynamicScope){entry.dynamic=true;unknown('with_dynamic_scope',node,'A with-object may shadow any lexical/global receiver binding.');}
      const directImported = dynamicScope?undefined:importedAt(callee);
      const imported = directImported ?? (!dynamicScope&&ts.isPropertyAccessExpression(callee) ? importedAt(unwrap(callee.expression)) : undefined);
      if (imported) { entry.module = imported.module; entry.imported = imported.imported; if (!directImported) entry.unresolvedMember = true; }
      const target = !entry.dynamic ? localTarget(ts.isPropertyAccessExpression(callee) ? callee.name : callee) : undefined;
      if (target) entry.target = target;
      references.push(entry);
      if (ts.isElementAccessExpression(callee)) {
        unknown('computed_property_call', node, nodeText(callee));
      } else if (entry.dynamic) {
        unknown('dynamic_call', node, nodeText(callee));
      }
      const http = dynamicScope?undefined:httpInfo(callee, node.arguments);
      if (http) {
        const dynamic = http.url === undefined || http.method === undefined;
        references.push({ kind: 'http', name: http.client, ...(http.url !== undefined ? { url: http.url } : {}), ...(http.method !== undefined ? { method: http.method } : {}), ...(dynamic ? { dynamic: true } : {}), range: range(node), ...(caller ? { caller } : {}) });
        const urlArgument = node.arguments[http.urlIndex ?? 0];
        if (http.url === undefined) unknown('dynamic_http_url', node, urlArgument ? nodeText(urlArgument) : 'Missing URL');
        if (http.method === undefined) unknown('dynamic_http_method', node, 'Method is not a direct literal or options may override it.');
        if (http.client === 'angular-http-client') unknown('angular_http_runtime_unverified', node,
          'The typed HttpClient call is source evidence only; Observable subscription, RxJS operators, interceptors, dependency injection and runtime execution are not verified.');
      } else if (!target && !imported && !entry.dynamic) {
        unknown('unresolved_call', node, nodeText(callee));
      }
      if (imported?.typeOnly) unknown('type_only_import_call', node, nodeText(callee));
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      // Intrinsic tags are platform elements; named components are source references.
      if (!ts.isIdentifier(tag) || !/^[a-z]/.test(tag.text)) {
        const target = localTarget(ts.isPropertyAccessExpression(tag) ? tag.name : tag);
        const imported = importedAt(tag);
        const caller = callerFor(node);
        references.push({ kind: 'type', name: nodeText(tag), ...(target ? { target } : {}), ...(imported ? { module: imported.module, imported: imported.imported } : {}), range: range(node), ...(caller ? { caller } : {}) });
      }
    } else if (ts.isTypeReferenceNode(node)) {
      const name = nodeText(node.typeName);
      const location = ts.isQualifiedName(node.typeName) ? node.typeName.right : node.typeName;
      const target = localTarget(location);
      const imported = ts.isIdentifier(node.typeName) ? importedAt(node.typeName)
        : ts.isQualifiedName(node.typeName) && ts.isIdentifier(node.typeName.left) ? importsBySymbol.get(symbolAt(node.typeName.left)) : undefined;
      references.push({ kind: 'type', name, ...(target ? { target } : {}), ...(imported ? { module: imported.module, imported: imported.imported === '*' && ts.isQualifiedName(node.typeName) ? node.typeName.right.text : imported.imported } : {}), range: range(node) });
    } else if (ts.isNewExpression(node) || ts.isExpressionWithTypeArguments(node)) {
      const name = nodeText(node.expression);
      const target = localTarget(ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression);
      const imported = importedAt(node.expression);
      references.push({ kind: 'type', name, ...(target ? { target } : {}), ...(imported ? { module: imported.module, imported: imported.imported } : {}), range: range(node) });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const angularPresent = Object.values(angular).some((facts) => facts.length > 0);
  return { language: 'typescript', declarations, references, endpoints: [], unknowns, ...(angularPresent ? { angular } : {}) };
}

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
  return node;
}
