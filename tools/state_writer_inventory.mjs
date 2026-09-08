import { createHash } from "node:crypto";
import path from "node:path";

import { parse } from "acorn";
import * as walk from "acorn-walk";

import {
  STATE_MUTATION_DELEGATING_OWNER_CONTRACT,
  findStateActionDelegationContractEntry,
  findStateImportedBorrowedProjectionContractEntry,
  findStateImportedPureReaderContractEntry,
  findStateImportedPureNormalizerContractEntry,
  findStateDetachedCaptureContractEntry,
  findStateMutationDelegatingOwnerFactoryContractEntry,
  findStateActionReadOnlyContractEntry,
} from "./state_action_delegation_contract.mjs";

const DEFAULT_PARAMETER_NAMES = Object.freeze([
  "target",
  "state",
  "runtimeState",
  "appState",
  "targetState",
]);
export const STATE_WRITER_PARAMETER_NAMES = DEFAULT_PARAMETER_NAMES;

export const DERIVED_ALIAS_TAINT_MODES = Object.freeze({
  STRICT: "strict",
  LEGACY_BASELINE: "legacy-baseline",
});

export function normalizeJavaScriptSource(source = "") {
  return String(source).replace(/\r\n?/g, "\n");
}

export function normalizeDerivedAliasTaintMode(
  value = DERIVED_ALIAS_TAINT_MODES.STRICT,
) {
  const normalized = String(
    value || DERIVED_ALIAS_TAINT_MODES.STRICT,
  ).trim();
  if (
    !Object.values(DERIVED_ALIAS_TAINT_MODES).includes(normalized)
  ) {
    const error = new Error(
      `Unknown derived alias taint mode: ${normalized || "<empty>"}`,
    );
    error.code = "derived-alias-taint-mode-invalid";
    error.mode = normalized;
    throw error;
  }
  return normalized;
}

const COLLECTION_MUTATOR_METHODS = new Set([
  "add",
  "clear",
  "copyWithin",
  "delete",
  "fill",
  "pop",
  "push",
  "reverse",
  "set",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

const OBJECT_MUTATION_OPERATIONS = new Map([
  ["Object.assign", "object-assign"],
  ["Object.defineProperty", "define-property"],
  ["Object.defineProperties", "define-properties"],
  ["Object.setPrototypeOf", "set-prototype"],
  ["Object.freeze", "freeze"],
  ["Object.seal", "seal"],
  ["Object.preventExtensions", "prevent-extensions"],
  ["Reflect.defineProperty", "reflect-define-property"],
  ["Reflect.set", "reflect-set"],
  ["Reflect.deleteProperty", "reflect-delete"],
  ["Reflect.setPrototypeOf", "reflect-set-prototype"],
  ["Reflect.preventExtensions", "reflect-prevent-extensions"],
]);

const PURE_STATIC_STATE_READ_CALLS = new Set([
  "Array.from",
  "Array.isArray",
  "JSON.stringify",
  "Object.entries",
  "Object.getOwnPropertyDescriptor",
  "Object.getOwnPropertyDescriptors",
  "Object.getOwnPropertyNames",
  "Object.getOwnPropertySymbols",
  "Object.getPrototypeOf",
  "Object.hasOwn",
  "Object.isExtensible",
  "Object.isFrozen",
  "Object.isSealed",
  "Object.keys",
  "Object.values",
  "Reflect.get",
  "Reflect.getOwnPropertyDescriptor",
  "Reflect.getPrototypeOf",
  "Reflect.has",
  "Reflect.isExtensible",
  "Reflect.ownKeys",
]);

const PURE_IDENTIFIER_STATE_READ_CALLS = new Set([
  "Boolean",
  "Number",
  "String",
  "structuredClone",
]);

const GLOBAL_REALM_IDENTIFIERS = new Set([
  "globalThis",
  "self",
  "window",
]);

const TRUSTED_INTRINSIC_ROOTS = new Set([
  ...[...PURE_STATIC_STATE_READ_CALLS].map(
    (name) => name.split(".", 1)[0],
  ),
  ...PURE_IDENTIFIER_STATE_READ_CALLS,
]);

const PURE_STATIC_STATE_READ_ARGUMENT_INDEXES = new Map(
  [...PURE_STATIC_STATE_READ_CALLS].map((name) => [name, [0]]),
);

const PURE_IDENTIFIER_STATE_READ_ARGUMENT_INDEXES = new Map(
  [...PURE_IDENTIFIER_STATE_READ_CALLS].map((name) => [name, [0]]),
);

const STRUCTURAL_TARGET_MUTATION_OPERATIONS = new Set([
  "set-prototype",
  "freeze",
  "seal",
  "prevent-extensions",
  "reflect-set-prototype",
  "reflect-prevent-extensions",
]);

const IMPORTED_COMPAT_TARGET_HELPERS = new Map([
  ["bindStateCompatSurface", 0],
  ["callRuntimeHook", 0],
  ["callRuntimeHooks", 0],
  ["registerRuntimeHook", 0],
]);

const LOGICAL_ASSIGNMENT_OPERATORS = new Set(["||=", "&&=", "??="]);

function stableUnique(values = []) {
  return [...new Set(values.map(String))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function normalizeBindings(bindings = []) {
  return (Array.isArray(bindings) ? bindings : [])
    .map((binding, index) => ({
      id: String(binding?.id || `binding-${index + 1}`),
      kind: String(binding?.kind || "module"),
      name: String(binding?.name || binding?.parameterName || ""),
      functionName: String(binding?.functionName || ""),
      parameterName: String(binding?.parameterName || binding?.name || ""),
      parameterIndex: Number.isInteger(binding?.parameterIndex)
        ? binding.parameterIndex
        : null,
      parameterPath: String(binding?.parameterPath || ""),
      importSource: String(binding?.importSource || ""),
      importedName: String(binding?.importedName || ""),
      aliasSources: stableUnique(binding?.aliasSources || []),
      aliasOperators: stableUnique(binding?.aliasOperators || []),
      locator: binding?.locator && typeof binding.locator === "object"
        ? {
          line: Number(binding.locator.line || 0),
          column: Number(binding.locator.column || 0),
        }
        : null,
    }))
    .filter((binding) => binding.name);
}

function parseFailureReason(error, source = "") {
  const message = String(error?.message || "");
  const input = String(source || "");
  if (input.lastIndexOf("/*") > input.lastIndexOf("*/")) {
    return "unterminated-block-comment";
  }
  if (/unterminated comment/i.test(message)) {
    return "unterminated-block-comment";
  }
  if (/unterminated regular expression/i.test(message)) {
    return "unterminated-regular-expression";
  }
  if (/unterminated string/i.test(message)) {
    return "unterminated-string";
  }
  if (/unterminated template/i.test(message)) {
    return "unterminated-template";
  }
  return "javascript-parse-error";
}

function parseJavaScript(source = "") {
  const input = String(source);
  const options = {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    allowHashBang: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  };
  try {
    const ast = parse(input, options);
    walk.full(ast, () => {});
    return { ast, diagnostic: null };
  } catch (moduleError) {
    if (/^\s*(?:import|export)\b/m.test(input)) {
      return {
        ast: null,
        diagnostic: {
          reason: parseFailureReason(moduleError, input),
          line: Number(moduleError?.loc?.line || 1),
          column: Number(moduleError?.loc?.column || 0) + 1,
          start: Number(moduleError?.pos || 0),
          end: Number(moduleError?.pos || 0),
          message: String(moduleError?.message || ""),
        },
      };
    }
    try {
      const ast = parse(input, {
        ...options,
        sourceType: "script",
      });
      walk.full(ast, () => {});
      return { ast, diagnostic: null };
    } catch (scriptError) {
      return {
        ast: null,
        diagnostic: {
          reason: parseFailureReason(scriptError, input),
          line: Number(scriptError?.loc?.line || 1),
          column: Number(scriptError?.loc?.column || 0) + 1,
          start: Number(scriptError?.pos || 0),
          end: Number(scriptError?.pos || 0),
          message: String(scriptError?.message || ""),
        },
      };
    }
  }
}

function isAstNode(value) {
  return Boolean(value && typeof value === "object" && typeof value.type === "string");
}

function childNodes(node) {
  const children = [];
  for (const [key, value] of Object.entries(node || {})) {
    if (["loc", "start", "end", "range"].includes(key)) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) {
          children.push({ key, node: item });
        }
      }
    } else if (isAstNode(value)) {
      children.push({ key, node: value });
    }
  }
  return children;
}

function collectPatternIdentifiers(pattern, results = []) {
  if (!pattern) {
    return results;
  }
  if (pattern.type === "Identifier") {
    results.push(pattern);
    return results;
  }
  if (pattern.type === "RestElement") {
    return collectPatternIdentifiers(pattern.argument, results);
  }
  if (pattern.type === "AssignmentPattern") {
    return collectPatternIdentifiers(pattern.left, results);
  }
  if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements || []) {
      collectPatternIdentifiers(element, results);
    }
    return results;
  }
  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties || []) {
      if (property.type === "RestElement") {
        collectPatternIdentifiers(property.argument, results);
      } else {
        collectPatternIdentifiers(property.value, results);
      }
    }
  }
  return results;
}

function appendParameterPath(parameterPath, segmentType, segmentValue = "") {
  const encodedValue = encodeURIComponent(String(segmentValue));
  return `${parameterPath}/${segmentType}${encodedValue ? `:${encodedValue}` : ""}`;
}

function collectParameterPatternBindings(
  pattern,
  parameterPath = "$",
  results = [],
) {
  if (!pattern) {
    return results;
  }
  if (pattern.type === "Identifier") {
    results.push({
      identifier: pattern,
      parameterPath,
    });
    return results;
  }
  if (pattern.type === "RestElement") {
    return collectParameterPatternBindings(
      pattern.argument,
      appendParameterPath(parameterPath, "rest"),
      results,
    );
  }
  if (pattern.type === "AssignmentPattern") {
    return collectParameterPatternBindings(
      pattern.left,
      parameterPath,
      results,
    );
  }
  if (pattern.type === "ArrayPattern") {
    for (const [index, element] of (pattern.elements || []).entries()) {
      collectParameterPatternBindings(
        element,
        appendParameterPath(parameterPath, "index", index),
        results,
      );
    }
    return results;
  }
  if (pattern.type === "ObjectPattern") {
    const propertyOccurrences = new Map();
    for (const [index, property] of (pattern.properties || []).entries()) {
      if (property.type === "RestElement") {
        collectParameterPatternBindings(
          property.argument,
          appendParameterPath(parameterPath, "rest"),
          results,
        );
        continue;
      }
      const staticKey = staticPropertyName(property.key, property.computed);
      const structuralKey = staticKey
        ? `property:${encodeURIComponent(staticKey)}`
        : `computed:${index}`;
      const occurrence = propertyOccurrences.get(structuralKey) || 0;
      propertyOccurrences.set(structuralKey, occurrence + 1);
      const uniqueStructuralKey = occurrence
        ? `${structuralKey}#${occurrence}`
        : structuralKey;
      collectParameterPatternBindings(
        property.value,
        `${parameterPath}/${uniqueStructuralKey}`,
        results,
      );
    }
  }
  return results;
}

function staticPropertyName(node, computed = false) {
  if (!node) {
    return "";
  }
  if (!computed && (node.type === "Identifier" || node.type === "PrivateIdentifier")) {
    return node.name;
  }
  if (node.type === "Literal" && ["string", "number"].includes(typeof node.value)) {
    return String(node.value);
  }
  if (
    node.type === "TemplateLiteral"
    && node.expressions.length === 0
    && node.quasis.length === 1
  ) {
    return String(node.quasis[0]?.value?.cooked ?? "");
  }
  return "";
}

function functionNameFromParent(node, parent) {
  if (node.id?.type === "Identifier") {
    return node.id.name;
  }
  if (
    parent?.type === "VariableDeclarator"
    && parent.id?.type === "Identifier"
  ) {
    return parent.id.name;
  }
  if (
    parent?.type === "AssignmentExpression"
    && parent.left?.type === "Identifier"
  ) {
    return parent.left.name;
  }
  if (parent?.type === "Property" || parent?.type === "MethodDefinition") {
    return staticPropertyName(parent.key, parent.computed);
  }
  const anchor = node?.body || node;
  const line = Number(anchor?.loc?.start?.line || 1);
  const column = Number(anchor?.loc?.start?.column || 0) + 1;
  return `<anonymous>@${line}:${column}`;
}

function isFunctionNode(node) {
  return [
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
  ].includes(node?.type);
}

function isImmutableFunctionRecord(record) {
  return Boolean(
    record?.kind === "function"
    || (
      record?.kind === "variable"
      && record.declarationKind === "const"
      && isFunctionNode(record.init)
    ),
  );
}

function createScope(type, node, parent = null) {
  const scope = {
    type,
    node,
    parent,
    start: Number(node?.start || 0),
    end: Number(node?.end || 0),
    declarations: new Map(),
    children: [],
  };
  parent?.children.push(scope);
  return scope;
}

function addDeclaration(scope, identifier, details = {}) {
  if (!scope || identifier?.type !== "Identifier") {
    return null;
  }
  if (details.declarationKind === "var") {
    const existingRecord = (scope.declarations.get(identifier.name) || [])
      .find((record) =>
        record.kind === "parameter"
        || (
          record.kind === "variable"
          && record.declarationKind === "var"
        )
      );
    if (existingRecord) {
      existingRecord.redeclarations.push({
        node: identifier,
        init: details.init || null,
        ownerNode: details.ownerNode || null,
      });
      return existingRecord;
    }
  }
  const record = {
    name: identifier.name,
    node: identifier,
    scope,
    start: Number(identifier.start || 0),
    end: Number(identifier.end || 0),
    kind: String(details.kind || "local"),
    declarationKind: String(details.declarationKind || ""),
    init: details.init || null,
    ownerNode: details.ownerNode || null,
    importKind: String(details.importKind || ""),
    importedName: String(details.importedName || ""),
    importSource: String(details.importSource || ""),
    parameterIndex: Number.isInteger(details.parameterIndex)
      ? details.parameterIndex
      : null,
    parameterPath: String(details.parameterPath || ""),
    redeclarations: [],
  };
  if (!scope.declarations.has(record.name)) {
    scope.declarations.set(record.name, []);
  }
  scope.declarations.get(record.name).push(record);
  return record;
}

function nearestFunctionOrProgramScope(scope) {
  let cursor = scope;
  while (cursor) {
    if (cursor.type === "function" || cursor.type === "program") {
      return cursor;
    }
    cursor = cursor.parent;
  }
  return scope;
}

function declarationScopeForVariable(scope, declarationKind) {
  return declarationKind === "var"
    ? nearestFunctionOrProgramScope(scope)
    : scope;
}

function buildAstAnalysis(ast) {
  const rootScope = createScope("program", ast, null);
  const nodeScopes = new WeakMap();
  const parentNodes = new WeakMap();
  const identifierRecords = new WeakMap();
  const functionRecords = [];
  const allBindingRecords = [];
  const allBindingRecordSet = new Set();

  function registerBindingRecord(record) {
    if (record && !allBindingRecordSet.has(record)) {
      allBindingRecordSet.add(record);
      allBindingRecords.push(record);
    }
  }

  function registerPattern(pattern, scope, details) {
    for (const identifier of collectPatternIdentifiers(pattern)) {
      const record = addDeclaration(scope, identifier, details);
      if (record) {
        identifierRecords.set(identifier, record);
        registerBindingRecord(record);
      }
    }
  }

  function visit(node, scope, parent = null, parentKey = "") {
    if (!isAstNode(node)) {
      return;
    }
    if (parent) parentNodes.set(node, parent);

    if (node.type === "FunctionDeclaration" && node.id) {
      registerPattern(node.id, scope, {
        kind: "function",
        declarationKind: "function",
        ownerNode: node,
      });
    } else if (node.type === "ClassDeclaration" && node.id) {
      registerPattern(node.id, scope, {
        kind: "class",
        declarationKind: "class",
        ownerNode: node,
      });
    } else if (node.type === "ImportDeclaration") {
      nodeScopes.set(node, scope);
      for (const specifier of node.specifiers || []) {
        const importedName = specifier.type === "ImportSpecifier"
          ? String(specifier.imported?.name || specifier.imported?.value || "")
          : specifier.type === "ImportDefaultSpecifier"
            ? "default"
            : "*";
        const record = addDeclaration(scope, specifier.local, {
          kind: "import",
          declarationKind: "import",
          ownerNode: specifier,
          importKind: specifier.type,
          importedName,
          importSource: node.source?.value,
        });
        if (record) {
          identifierRecords.set(specifier.local, record);
          registerBindingRecord(record);
        }
      }
      return;
    }

    if (isFunctionNode(node)) {
      const functionScope = createScope("function", node, scope);
      nodeScopes.set(node, functionScope);
      const functionRecord = {
        node,
        name: functionNameFromParent(node, parent),
        scope: functionScope,
        parentScope: scope,
        parameterRecords: [],
      };
      functionRecords.push(functionRecord);
      if (node.type === "FunctionExpression" && node.id) {
        const selfRecord = addDeclaration(functionScope, node.id, {
          kind: "function-self",
          declarationKind: "function",
          ownerNode: node,
        });
        if (selfRecord) {
          identifierRecords.set(node.id, selfRecord);
          registerBindingRecord(selfRecord);
        }
      }
      for (
        const [parameterIndex, parameter] of (node.params || []).entries()
      ) {
        for (
          const { identifier, parameterPath } of
          collectParameterPatternBindings(parameter)
        ) {
          const record = addDeclaration(functionScope, identifier, {
            kind: "parameter",
            declarationKind: "parameter",
            ownerNode: node,
            parameterIndex,
            parameterPath,
          });
          if (record) {
            identifierRecords.set(identifier, record);
            registerBindingRecord(record);
            functionRecord.parameterRecords.push(record);
          }
        }
        visitPatternExpressions(parameter, functionScope, node);
      }
      visit(node.body, functionScope, node, "body");
      return;
    }

    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const classScope = createScope("class", node, scope);
      nodeScopes.set(node, classScope);
      if (node.id) {
        const selfRecord = addDeclaration(classScope, node.id, {
          kind: "class-self",
          declarationKind: "class",
          ownerNode: node,
        });
        if (selfRecord) {
          identifierRecords.set(node.id, selfRecord);
          registerBindingRecord(selfRecord);
        }
      }
      visit(node.superClass, scope, node, "superClass");
      visit(node.body, classScope, node, "body");
      return;
    }

    let effectiveScope = scope;
    if (node.type === "BlockStatement") {
      effectiveScope = createScope("block", node, scope);
    } else if (node.type === "CatchClause") {
      effectiveScope = createScope("catch", node, scope);
      registerPattern(node.param, effectiveScope, {
        kind: "catch-parameter",
        declarationKind: "catch",
        ownerNode: node,
      });
    } else if (
      ["ForStatement", "ForInStatement", "ForOfStatement", "SwitchStatement"].includes(
        node.type,
      )
    ) {
      effectiveScope = createScope("block", node, scope);
    } else if (node.type === "StaticBlock") {
      effectiveScope = createScope("block", node, scope);
    }
    nodeScopes.set(node, effectiveScope);

    if (node.type === "VariableDeclaration") {
      const declarationScope = declarationScopeForVariable(
        effectiveScope,
        node.kind,
      );
      for (const declarator of node.declarations || []) {
        registerPattern(declarator.id, declarationScope, {
          kind: "variable",
          declarationKind: node.kind,
          init: declarator.init,
          ownerNode: declarator,
        });
      }
    }

    for (const child of childNodes(node)) {
      if (
        node.type === "CatchClause"
        && child.key === "param"
      ) {
        visitPatternExpressions(child.node, effectiveScope, node);
        continue;
      }
      visit(child.node, effectiveScope, node, child.key);
    }
  }

  function visitPatternExpressions(pattern, scope, parent) {
    if (!pattern) {
      return;
    }
    if (pattern.type === "AssignmentPattern") {
      visit(pattern.right, scope, parent, "right");
      visitPatternExpressions(pattern.left, scope, parent);
      return;
    }
    if (pattern.type === "RestElement") {
      visitPatternExpressions(pattern.argument, scope, parent);
      return;
    }
    if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements || []) {
        visitPatternExpressions(element, scope, parent);
      }
      return;
    }
    if (pattern.type === "ObjectPattern") {
      for (const property of pattern.properties || []) {
        if (property.type === "RestElement") {
          visitPatternExpressions(property.argument, scope, parent);
          continue;
        }
        if (property.computed) {
          visit(property.key, scope, property, "key");
        }
        visitPatternExpressions(property.value, scope, property);
      }
    }
  }

  visit(ast, rootScope, null, "");

  function resolveIdentifier(identifier) {
    if (identifier?.type !== "Identifier") {
      return null;
    }
    if (identifierRecords.has(identifier)) {
      return identifierRecords.get(identifier);
    }
    let scope = nodeScopes.get(identifier) || rootScope;
    while (scope) {
      const declarations = scope.declarations.get(identifier.name) || [];
      if (declarations.length) {
        return declarations.at(-1);
      }
      scope = scope.parent;
    }
    return null;
  }

  function isScopeDescendant(scope, ancestorScope) {
    let cursor = scope;
    while (cursor) {
      if (cursor === ancestorScope) {
        return true;
      }
      cursor = cursor.parent;
    }
    return false;
  }

  return {
    ast,
    rootScope,
    nodeScopes,
    parentNodeForNode(node) {
      return parentNodes.get(node) || null;
    },
    identifierRecords,
    functionRecords: functionRecords.sort(
      (left, right) => left.node.start - right.node.start,
    ),
    allBindingRecords,
    resolveIdentifier,
    isScopeDescendant,
  };
}

let lastJavaScriptAnalysisCache = null;

function parseAndAnalyzeJavaScript(source = "") {
  const input = normalizeJavaScriptSource(source);
  if (lastJavaScriptAnalysisCache?.source === input) {
    return lastJavaScriptAnalysisCache.result;
  }
  const parsed = parseJavaScript(input);
  const result = {
    parsed,
    analysis: parsed.ast ? buildAstAnalysis(parsed.ast) : null,
  };
  lastJavaScriptAnalysisCache = {
    source: input,
    result,
  };
  return result;
}

function functionLocator(functionRecord) {
  const node = functionRecord?.node?.body || functionRecord?.node;
  return {
    line: Number(node?.loc?.start?.line || 1),
    column: Number(node?.loc?.start?.column || 0) + 1,
  };
}

function locatorMatches(functionRecord, locator) {
  if (!locator?.line && !locator?.column) {
    return true;
  }
  const actual = functionLocator(functionRecord);
  return (!locator.line || Number(locator.line) === actual.line)
    && (!locator.column || Number(locator.column) === actual.column);
}

function flattenLogicalExpression(node, operators = [], operands = []) {
  if (node?.type === "LogicalExpression") {
    operators.push(node.operator);
    flattenLogicalExpression(node.left, operators, operands);
    flattenLogicalExpression(node.right, operators, operands);
  } else if (node) {
    operands.push(node);
  }
  return { operators, operands };
}

function validateLocalAliasRecord(record, binding) {
  if (!record?.init) {
    return false;
  }
  const { operators, operands } = flattenLogicalExpression(record.init);
  if (!operators.length) {
    return false;
  }
  const allowedOperators = new Set(binding.aliasOperators || []);
  const allowedSources = new Set(binding.aliasSources || []);
  return operators.every((operator) => allowedOperators.has(operator))
    && operands.length === allowedSources.size
    && operands.every(
      (operand) =>
        operand.type === "Identifier" && allowedSources.has(operand.name),
    );
}

function resolveConfiguredBinding(analysis, binding) {
  if (binding.kind === "module") {
    const programDeclarations =
      analysis.rootScope.declarations.get(binding.name) || [];
    const imports = programDeclarations.filter(
      (record) => record.kind === "import",
    );
    return {
      targetRecords: new Set(imports),
      virtualModuleName: imports.length ? "" : binding.name,
      testRootName: "",
      issue: imports.length > 1 ? "binding-locator-ambiguous" : "",
      issueNode: imports[0]?.node || analysis.ast,
    };
  }

  if (binding.kind === "test-file-root") {
    return {
      targetRecords: new Set(
        analysis.allBindingRecords.filter(
          (record) => record.name === binding.name,
        ),
      ),
      virtualModuleName: "",
      testRootName: binding.name,
      issue: "",
      issueNode: analysis.ast,
    };
  }

  const functionCandidates = analysis.functionRecords.filter(
    (record) =>
      record.name === binding.functionName
      && locatorMatches(record, binding.locator),
  );

  if (binding.kind === "function-parameter") {
    const matches = functionCandidates.flatMap((functionRecord) =>
      functionRecord.parameterRecords.filter(
        (record) =>
          (
            binding.parameterPath
              ? record.parameterPath === binding.parameterPath
              : record.name === binding.parameterName
          )
          && (
            binding.parameterIndex === null
            || record.parameterIndex === binding.parameterIndex
          ),
      )
    );
    return {
      targetRecords: new Set(matches),
      virtualModuleName: "",
      testRootName: "",
      issue: matches.length === 1
        ? ""
        : matches.length
          ? "binding-locator-ambiguous"
          : "binding-locator-missing",
      issueNode: matches[0]?.node || functionCandidates[0]?.node || analysis.ast,
    };
  }

  if (
    binding.kind === "function-local"
    || binding.kind === "function-local-alias"
  ) {
    const matches = [];
    for (const functionRecord of functionCandidates) {
      for (const record of analysis.allBindingRecords) {
        if (
          record.name === binding.name
          && record.kind !== "parameter"
          && analysis.isScopeDescendant(record.scope, functionRecord.scope)
        ) {
          matches.push(record);
        }
      }
    }
    const exactMatches = binding.kind === "function-local-alias"
      ? matches.filter((record) => validateLocalAliasRecord(record, binding))
      : matches;
    const invalidAlias = binding.kind === "function-local-alias"
      && matches.length === 1
      && exactMatches.length === 0;
    return {
      targetRecords: new Set(exactMatches),
      virtualModuleName: "",
      testRootName: "",
      issue: exactMatches.length === 1
        ? ""
        : invalidAlias
          ? "binding-local-alias-invalid"
          : exactMatches.length
            ? "binding-locator-ambiguous"
            : "binding-locator-missing",
      issueNode:
        exactMatches[0]?.node
        || matches[0]?.node
        || functionCandidates[0]?.node
        || analysis.ast,
    };
  }

  return {
    targetRecords: new Set(),
    virtualModuleName: "",
    testRootName: "",
    issue: "binding-kind-unsupported",
    issueNode: analysis.ast,
  };
}

function unwrapChain(node) {
  return node?.type === "ChainExpression" ? node.expression : node;
}

function createReferenceResolver(analysis, binding, resolution, aliasRecords) {
  function targetProvenance(identifier) {
    if (identifier?.type !== "Identifier") {
      return null;
    }
    const record = analysis.resolveIdentifier(identifier);
    const trackedState = record ? aliasRecords.get(record) : null;
    if (trackedState) {
      if (!trackedState.active) {
        return null;
      }
      return {
        binding,
        record,
        baseSegments: trackedState.baseSegments,
        alias: resolution.targetRecords.has(record) ? "" : identifier.name,
        aliasChain: trackedState.aliasChain,
      };
    }
    if (record && resolution.targetRecords.has(record)) {
      return {
        binding,
        record,
        baseSegments: [],
        alias: "",
        aliasChain: [],
      };
    }
    if (
      binding.kind === "test-file-root"
      && identifier.name === resolution.testRootName
      && (!record || resolution.targetRecords.has(record))
    ) {
      return {
        binding,
        record,
        baseSegments: [],
        alias: "",
        aliasChain: [],
      };
    }
    if (
      resolution.virtualModuleName
      && identifier.name === resolution.virtualModuleName
      && !record
    ) {
      return {
        binding,
        record: null,
        baseSegments: [],
        alias: "",
        aliasChain: [],
      };
    }
    return null;
  }

  function resolveReference(expression) {
    const node = unwrapChain(expression);
    if (!node) {
      return null;
    }
    if (node.type === "Identifier") {
      const provenance = targetProvenance(node);
      if (!provenance) {
        return null;
      }
      return {
        binding,
        rootNode: node,
        alias: provenance.alias,
        aliasChain: [...provenance.aliasChain],
        segments: provenance.baseSegments.map((segment) => ({ ...segment })),
      };
    }
    if (node.type !== "MemberExpression") {
      return null;
    }
    const parentReference = resolveReference(node.object);
    if (!parentReference) {
      return null;
    }
    const key = staticPropertyName(node.property, node.computed);
    return {
      ...parentReference,
      segments: [
        ...parentReference.segments,
        {
          key: key || "*",
          dynamic: !key,
        },
      ],
    };
  }

  return {
    resolveReference,
    targetProvenance,
  };
}

function locationFromNode(node) {
  return {
    line: Number(node?.loc?.start?.line || 1),
    column: Number(node?.loc?.start?.column || 0) + 1,
    endLine: Number(node?.loc?.end?.line || node?.loc?.start?.line || 1),
    endColumn: Number(node?.loc?.end?.column || node?.loc?.start?.column || 0) + 1,
  };
}

function createFinding(
  filePath,
  binding,
  reference,
  operation,
  node,
  overrides = {},
) {
  const pathSegments = overrides.pathSegments
    || reference?.segments?.map((segment) => segment.key)
    || ["*"];
  const location = locationFromNode(node);
  return {
    filePath: String(filePath || ""),
    bindingId: binding.id,
    bindingKind: binding.kind,
    root: binding.name,
    alias: reference?.alias || "",
    aliasChain: [...(reference?.aliasChain || [])],
    operation,
    key: overrides.key ?? pathSegments[0] ?? "*",
    pathSegments,
    dynamic: overrides.dynamic
      ?? (
        pathSegments.includes("*")
        || Boolean(reference?.segments?.some((segment) => segment.dynamic))
      ),
    unsupported: Boolean(overrides.unsupported),
    reason: String(overrides.reason || ""),
    ...(overrides.evidenceKind
      ? { evidenceKind: String(overrides.evidenceKind) }
      : {}),
    start: Number(node?.start || 0),
    end: Number(node?.end || node?.start || 0),
    ...location,
  };
}

function createUnsupportedFinding(filePath, binding, issue = {}) {
  const node = issue.node || {
    start: Number(issue.start || 0),
    end: Number(issue.end || issue.start || 0),
    loc: {
      start: {
        line: Number(issue.line || 1),
        column: Math.max(0, Number(issue.column || 1) - 1),
      },
      end: {
        line: Number(issue.line || 1),
        column: Math.max(0, Number(issue.column || 1) - 1),
      },
    },
  };
  return createFinding(
    filePath,
    binding || {
      id: "syntax",
      kind: "syntax",
      name: "",
    },
    null,
    "unsupported",
    node,
    {
      key: "*",
      pathSegments: ["*"],
      dynamic: true,
      unsupported: true,
      reason: issue.reason || "unsupported-mutation-site",
      evidenceKind: issue.evidenceKind || "",
    },
  );
}

const functionIdentityContextByAnalysis = new WeakMap();

function normalizedFunctionIdentityName(value = "") {
  return String(value || "")
    .replace(/^<anonymous>@\d+:\d+$/, "<anonymous>");
}

function getFunctionIdentityContext(analysis) {
  if (functionIdentityContextByAnalysis.has(analysis)) {
    return functionIdentityContextByAnalysis.get(analysis);
  }
  const records = [...(analysis.functionRecords || [])].sort(
    (left, right) =>
      Number(left.node?.start) - Number(right.node?.start)
      || Number(right.node?.end) - Number(left.node?.end),
  );
  const recordByNode = new WeakMap(
    records.map((record) => [record.node, record]),
  );
  const parentByNode = new WeakMap();
  const nestingStack = [];
  for (const record of records) {
    while (
      nestingStack.length
      && Number(nestingStack.at(-1).node?.end)
        < Number(record.node?.end)
    ) {
      nestingStack.pop();
    }
    parentByNode.set(
      record.node,
      nestingStack.at(-1) || null,
    );
    nestingStack.push(record);
  }
  const siblingGroupsByParent = new Map();
  for (const record of records) {
    const parentNode = parentByNode.get(record.node)?.node
      || analysis.ast;
    if (!siblingGroupsByParent.has(parentNode)) {
      siblingGroupsByParent.set(parentNode, new Map());
    }
    const name = normalizedFunctionIdentityName(record.name);
    const siblingGroups = siblingGroupsByParent.get(parentNode);
    if (!siblingGroups.has(name)) {
      siblingGroups.set(name, []);
    }
    siblingGroups.get(name).push(record);
  }
  const ordinalByNode = new WeakMap();
  for (const siblingGroups of siblingGroupsByParent.values()) {
    for (const siblings of siblingGroups.values()) {
      siblings.forEach((record, ordinal) => {
        ordinalByNode.set(record.node, ordinal);
      });
    }
  }
  const identityByNode = new WeakMap();
  const identityForFunctionNode = (functionNode) => {
    if (!functionNode) {
      return JSON.stringify({ kind: "program" });
    }
    if (identityByNode.has(functionNode)) {
      return identityByNode.get(functionNode);
    }
    const ancestry = [];
    let record = recordByNode.get(functionNode) || null;
    while (record) {
      ancestry.unshift({
        name: normalizedFunctionIdentityName(record.name),
        ordinal: Number(ordinalByNode.get(record.node) || 0),
      });
      record = parentByNode.get(record.node) || null;
    }
    const identity = JSON.stringify({
      kind: "function",
      ancestry,
    });
    identityByNode.set(functionNode, identity);
    return identity;
  };
  const decorateSortedFindings = (findings) => {
    let functionCursor = 0;
    const activeFunctions = [];
    return findings.map((finding) => {
      while (
        functionCursor < records.length
        && Number(records[functionCursor].node?.start)
          <= Number(finding.start)
      ) {
        const record = records[functionCursor];
        while (
          activeFunctions.length
          && Number(activeFunctions.at(-1).node?.end)
            < Number(record.node?.end)
        ) {
          activeFunctions.pop();
        }
        activeFunctions.push(record);
        functionCursor += 1;
      }
      while (
        activeFunctions.length
        && Number(activeFunctions.at(-1).node?.end)
          < Number(finding.end)
      ) {
        activeFunctions.pop();
      }
      return {
        ...finding,
        enclosingFunctionIdentity: identityForFunctionNode(
          activeFunctions.at(-1)?.node || null,
        ),
      };
    });
  };
  const context = {
    identityForFunctionNode,
    decorateSortedFindings,
  };
  functionIdentityContextByAnalysis.set(analysis, context);
  return context;
}

const bindingMutationAnalysisContextByAnalysis = new WeakMap();

function prepareBindingMutationAnalysisContext(
  analysis,
  analysisInstrumentation = null,
) {
  if (
    typeof analysisInstrumentation
      ?.onPrepareBindingMutationAnalysis === "function"
  ) {
    analysisInstrumentation.onPrepareBindingMutationAnalysis();
  }

  const functionRecordByNode = new WeakMap(
    analysis.functionRecords.map((functionRecord) => [
      functionRecord.node,
      functionRecord,
    ]),
  );
  const directReturnsByFunctionNode = new Map();
  walk.ancestor(analysis.ast, {
    ReturnStatement(node, ancestors) {
      const ownerFunction = [...ancestors]
        .slice(0, -1)
        .reverse()
        .find(isFunctionNode);
      if (!ownerFunction) {
        return;
      }
      if (!directReturnsByFunctionNode.has(ownerFunction)) {
        directReturnsByFunctionNode.set(ownerFunction, []);
      }
      directReturnsByFunctionNode.get(ownerFunction).push(node);
    },
  });
  for (const [functionNode, returnStatements] of directReturnsByFunctionNode) {
    directReturnsByFunctionNode.set(
      functionNode,
      Object.freeze([...returnStatements]),
    );
  }

  function returnedFunctionNodes(expression) {
    const node = unwrapChain(expression);
    if (!node) {
      return [];
    }
    if (isFunctionNode(node)) {
      return [node];
    }
    if (node.type === "Identifier") {
      const record = analysis.resolveIdentifier(node);
      if (
        record?.kind === "function"
        && isFunctionNode(record.ownerNode)
      ) {
        return [record.ownerNode];
      }
      if (
        record?.kind === "variable"
        && record.declarationKind === "const"
        && isFunctionNode(record.init)
      ) {
        return [record.init];
      }
      return [];
    }
    if (node.type === "ObjectExpression") {
      return node.properties.flatMap((property) =>
        property.type === "Property"
          ? returnedFunctionNodes(property.value)
          : []
      );
    }
    if (node.type === "ArrayExpression") {
      return node.elements.flatMap((element) =>
        returnedFunctionNodes(element)
      );
    }
    if (node.type === "ConditionalExpression") {
      return [
        ...returnedFunctionNodes(node.consequent),
        ...returnedFunctionNodes(node.alternate),
      ];
    }
    if (node.type === "LogicalExpression") {
      return [
        ...returnedFunctionNodes(node.left),
        ...returnedFunctionNodes(node.right),
      ];
    }
    if (node.type === "SequenceExpression") {
      return returnedFunctionNodes(node.expressions.at(-1));
    }
    if (node.type === "CallExpression") {
      const callee = unwrapChain(node.callee);
      const isUnshadowedObjectWrapper = Boolean(
        callee?.type === "MemberExpression"
        && callee.object?.type === "Identifier"
        && callee.object.name === "Object"
        && !analysis.resolveIdentifier(callee.object)
        && ["freeze", "seal"].includes(
          staticPropertyName(callee.property, callee.computed),
        )
      );
      return isUnshadowedObjectWrapper
        ? returnedFunctionNodes(node.arguments[0])
        : [];
    }
    return [];
  }

  const returnedFunctionNodesByFunctionNode = new Map(
    [...directReturnsByFunctionNode].map(
      ([functionNode, returnStatements]) => [
        functionNode,
        Object.freeze(
          returnStatements.flatMap((returnStatement) =>
            returnedFunctionNodes(returnStatement.argument)
          ),
        ),
      ],
    ),
  );
  const syntacticExportedFunctionNodes = new Set();
  for (const statement of analysis.ast?.body || []) {
    if (
      ["ExportNamedDeclaration", "ExportDefaultDeclaration"]
        .includes(statement.type)
      && isFunctionNode(statement.declaration)
    ) {
      syntacticExportedFunctionNodes.add(statement.declaration);
    }
    if (
      statement.type === "ExportNamedDeclaration"
      && statement.declaration?.type === "VariableDeclaration"
    ) {
      for (
        const declarator of statement.declaration.declarations || []
      ) {
        if (isFunctionNode(declarator.init)) {
          syntacticExportedFunctionNodes.add(declarator.init);
        }
      }
    }
    if (
      statement.type === "ExportNamedDeclaration"
      && !statement.source
    ) {
      for (const specifier of statement.specifiers || []) {
        const record = analysis.resolveIdentifier(specifier.local);
        if (isFunctionNode(record?.ownerNode)) {
          syntacticExportedFunctionNodes.add(record.ownerNode);
        } else if (isFunctionNode(record?.init)) {
          syntacticExportedFunctionNodes.add(record.init);
        }
      }
    }
  }

  function closeExportedFunctionNodes(seeds) {
    const result = new Set(seeds);
    const queue = [...result];
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      for (
        const exposedFunction of
        returnedFunctionNodesByFunctionNode.get(queue[queueIndex]) || []
      ) {
        if (result.has(exposedFunction)) {
          continue;
        }
        result.add(exposedFunction);
        queue.push(exposedFunction);
      }
    }
    return result;
  }

  const baseExportedFunctionNodes = closeExportedFunctionNodes(
    syntacticExportedFunctionNodes,
  );
  const trustedGlobalAliasPathsByRecord = new Map();

  function canonicalizeTrustedGlobalPath(value) {
    const segments = String(value || "").split(".").filter(Boolean);
    if (
      segments.length > 1
      && GLOBAL_REALM_IDENTIFIERS.has(segments[0])
    ) {
      segments.shift();
    }
    return segments.join(".");
  }

  function trustedGlobalReferencePath(expression) {
    const node = unwrapChain(expression);
    if (node?.type === "Identifier") {
      const record = analysis.resolveIdentifier(node);
      return record
        ? trustedGlobalAliasPathsByRecord.get(record) || ""
        : canonicalizeTrustedGlobalPath(node.name);
    }
    if (node?.type === "CallExpression") {
      const callPath = trustedGlobalReferencePath(node.callee);
      const prototypeTarget = unwrapChain(node.arguments?.[0]);
      if (
        (callPath === "Object.getPrototypeOf"
          || callPath === "Reflect.getPrototypeOf")
        && (node.arguments || []).length === 1
      ) {
        const targetPath = trustedGlobalReferencePath(prototypeTarget);
        if (
          targetPath === "Map"
          || targetPath.startsWith("Map.prototype.get")
        ) {
          return "Function.prototype";
        }
        if (
          prototypeTarget?.type === "NewExpression"
          && prototypeTarget.callee?.type === "Identifier"
          && prototypeTarget.callee.name === "Map"
          && !analysis.resolveIdentifier(prototypeTarget.callee)
        ) {
          return "Map.prototype";
        }
      }
      return "";
    }
    if (node?.type !== "MemberExpression") {
      return "";
    }
    const objectPath = trustedGlobalReferencePath(node.object);
    const propertyName = staticPropertyName(node.property, node.computed);
    const isMapIntrinsicFunction = [
      "Map.prototype.get",
      "Map.prototype.get.call",
    ].includes(objectPath);
    const memberObject = unwrapChain(node.object);
    if (
      propertyName === "__proto__"
      && memberObject?.type === "NewExpression"
      && memberObject.callee?.type === "Identifier"
      && memberObject.callee.name === "Map"
      && !analysis.resolveIdentifier(memberObject.callee)
    ) {
      return "Map.prototype";
    }
    if (
      (propertyName === "__proto__" || propertyName === "constructor")
      && (objectPath === "Map" || isMapIntrinsicFunction)
    ) {
      return propertyName === "constructor" ? "Function" : "Function.prototype";
    }
    const result = objectPath && propertyName
      ? `${objectPath}.${propertyName}`
      : "";
    return canonicalizeTrustedGlobalPath(result);
  }

  function trustedGlobalPatternAliasEntries(pattern, sourcePath) {
    const node = unwrapChain(pattern);
    if (!node || !sourcePath) {
      return [];
    }
    if (node.type === "Identifier") {
      return [{ identifier: node, path: sourcePath }];
    }
    if (node.type === "AssignmentPattern") {
      return trustedGlobalPatternAliasEntries(node.left, sourcePath);
    }
    if (node.type === "RestElement") {
      return [];
    }
    if (node.type === "ArrayPattern") {
      return node.elements.flatMap((element, index) =>
        trustedGlobalPatternAliasEntries(
          element,
          canonicalizeTrustedGlobalPath(`${sourcePath}.${index}`),
        )
      );
    }
    if (node.type === "ObjectPattern") {
      return node.properties.flatMap((property) => {
        if (property.type !== "Property") {
          return [];
        }
        const propertyName = staticPropertyName(
          property.key,
          property.computed,
        );
        return propertyName
          ? trustedGlobalPatternAliasEntries(
            property.value,
            canonicalizeTrustedGlobalPath(
              `${sourcePath}.${propertyName}`,
            ),
          )
          : [];
      });
    }
    return [];
  }

  let invariantFullWalks = 0;
  let previousTrustedAliasCount = -1;
  while (
    previousTrustedAliasCount
    !== trustedGlobalAliasPathsByRecord.size
  ) {
    previousTrustedAliasCount = trustedGlobalAliasPathsByRecord.size;
    invariantFullWalks += 1;
    walk.full(analysis.ast, (node) => {
      if (node.type !== "VariableDeclarator") {
        return;
      }
      const trustedPath = trustedGlobalReferencePath(node.init);
      if (!trustedPath) {
        return;
      }
      for (
        const { identifier, path: aliasPath } of
        trustedGlobalPatternAliasEntries(node.id, trustedPath)
      ) {
        const record = analysis.resolveIdentifier(identifier);
        if (
          !record
          || record.declarationKind !== "const"
          || trustedGlobalAliasPathsByRecord.has(record)
        ) {
          continue;
        }
        trustedGlobalAliasPathsByRecord.set(record, aliasPath);
      }
    });
  }

  function unshadowedStaticMutationPath(expression) {
    return trustedGlobalReferencePath(expression);
  }

  function unshadowedStaticMutationPaths(expression) {
    const node = unwrapChain(expression);
    if (!node) {
      return [];
    }
    if (
      node.type === "Identifier"
      || node.type === "MemberExpression"
    ) {
      const mutationPath = unshadowedStaticMutationPath(node);
      return mutationPath ? [mutationPath] : [];
    }
    if (node.type === "AssignmentPattern") {
      return unshadowedStaticMutationPaths(node.left);
    }
    if (node.type === "RestElement") {
      return unshadowedStaticMutationPaths(node.argument);
    }
    if (node.type === "ArrayPattern") {
      return node.elements.flatMap(
        (element) => unshadowedStaticMutationPaths(element),
      );
    }
    if (node.type === "ObjectPattern") {
      return node.properties.flatMap((property) =>
        property.type === "RestElement"
          ? unshadowedStaticMutationPaths(property.argument)
          : unshadowedStaticMutationPaths(property.value)
      );
    }
    return [];
  }

  function unshadowedStaticMutationCallPaths(node) {
    if (node?.type !== "CallExpression") {
      return [];
    }
    const mutationCallName = trustedGlobalReferencePath(node.callee);
    if (!OBJECT_MUTATION_OPERATIONS.has(mutationCallName)) {
      return [];
    }
    const targetPath = unshadowedStaticMutationPath(node.arguments?.[0]);
    if (!targetPath) {
      return [];
    }
    if (
      [
        "Object.defineProperty",
        "Reflect.defineProperty",
        "Reflect.set",
      ].includes(mutationCallName)
    ) {
      const propertyName = staticPropertyName(node.arguments?.[1], true);
      return [
        propertyName
          ? canonicalizeTrustedGlobalPath(
            `${targetPath}.${propertyName}`,
          )
          : targetPath,
      ];
    }
    if (
      GLOBAL_REALM_IDENTIFIERS.has(targetPath)
      && [
        "Object.assign",
        "Object.defineProperties",
      ].includes(mutationCallName)
    ) {
      const sourceArguments = mutationCallName === "Object.assign"
        ? node.arguments.slice(1)
        : [node.arguments?.[1]];
      const mutationPaths = [];
      for (const sourceArgument of sourceArguments) {
        if (sourceArgument?.type !== "ObjectExpression") {
          return [...TRUSTED_INTRINSIC_ROOTS];
        }
        for (const property of sourceArgument.properties || []) {
          if (property.type !== "Property") {
            return [...TRUSTED_INTRINSIC_ROOTS];
          }
          const propertyName = staticPropertyName(
            property.key,
            property.computed,
          );
          if (!propertyName) {
            return [...TRUSTED_INTRINSIC_ROOTS];
          }
          mutationPaths.push(propertyName);
        }
      }
      return mutationPaths;
    }
    if (GLOBAL_REALM_IDENTIFIERS.has(targetPath)) {
      return [...TRUSTED_INTRINSIC_ROOTS];
    }
    return [targetPath];
  }

  const mapPrototypeGetIntrinsicGuardPaths = new Set([
    "Map",
    "Map.prototype",
    "Map.prototype.get",
    "Map.prototype.get.call",
    "Function",
    "Function.prototype",
    "Function.prototype.call",
  ]);

  function unshadowedStaticExternalEscapePaths(node) {
    if (node?.type !== "CallExpression") {
      return [];
    }
    const callName = trustedGlobalReferencePath(node.callee);
    if (
      OBJECT_MUTATION_OPERATIONS.has(callName)
      || PURE_STATIC_STATE_READ_CALLS.has(callName)
      || PURE_IDENTIFIER_STATE_READ_CALLS.has(callName)
    ) {
      return [];
    }
    const escapedPaths = new Set();
    for (const argument of node.arguments || []) {
      walk.full(argument, (descendant) => {
        const path = trustedGlobalReferencePath(descendant);
        if (mapPrototypeGetIntrinsicGuardPaths.has(path)) {
          escapedPaths.add(path);
        }
      });
    }
    return [...escapedPaths];
  }

  const mutatedUnshadowedStaticPaths = new Set();
  const identityTransitionRecords = new Set();
  const identityTransitionSourcesByRecord = new Map();
  function recordIdentityTransition(record, source = null) {
    if (!record) return;
    identityTransitionRecords.add(record);
    if (!source) return;
    if (!identityTransitionSourcesByRecord.has(record)) {
      identityTransitionSourcesByRecord.set(record, []);
    }
    identityTransitionSourcesByRecord.get(record).push(source);
  }
  invariantFullWalks += 1;
  walk.full(analysis.ast, (node) => {
    const staticMutationTarget = node.type === "AssignmentExpression"
      ? node.left
      : node.type === "UpdateExpression"
        ? node.argument
        : node.type === "UnaryExpression" && node.operator === "delete"
          ? node.argument
          : (
              node.type === "ForInStatement"
              || node.type === "ForOfStatement"
            ) && node.left.type !== "VariableDeclaration"
            ? node.left
            : null;
    for (
      const staticMutationPath of
      unshadowedStaticMutationPaths(staticMutationTarget)
    ) {
      mutatedUnshadowedStaticPaths.add(staticMutationPath);
    }
    for (
      const staticMutationPath of
      unshadowedStaticMutationCallPaths(node)
    ) {
      mutatedUnshadowedStaticPaths.add(staticMutationPath);
    }
    for (
      const staticEscapePath of
      unshadowedStaticExternalEscapePaths(node)
    ) {
      mutatedUnshadowedStaticPaths.add(staticEscapePath);
    }
    if (
      node.type === "AssignmentExpression"
      && node.left.type !== "MemberExpression"
    ) {
      for (const identifier of collectPatternIdentifiers(node.left)) {
        const record = analysis.resolveIdentifier(identifier);
        recordIdentityTransition(record, node.right);
      }
    } else if (
      node.type === "UpdateExpression"
      && node.argument.type === "Identifier"
    ) {
      const record = analysis.resolveIdentifier(node.argument);
      recordIdentityTransition(record);
    } else if (
      (node.type === "ForInStatement" || node.type === "ForOfStatement")
      && node.left.type !== "VariableDeclaration"
    ) {
      for (const identifier of collectPatternIdentifiers(node.left)) {
        const record = analysis.resolveIdentifier(identifier);
        recordIdentityTransition(record, node.right);
      }
    }
  });

  const functionIdentityContext = getFunctionIdentityContext(analysis);
  const context = Object.freeze({
    deriveExportedFunctionNodes(targetRecords = []) {
      const seeds = new Set(baseExportedFunctionNodes);
      for (const record of targetRecords) {
        if (isFunctionNode(record?.ownerNode)) {
          seeds.add(record.ownerNode);
        }
      }
      return closeExportedFunctionNodes(seeds);
    },
    functionNameForNode(node) {
      return functionRecordByNode.get(node)?.name || "";
    },
    functionRecordForNode(node) {
      return functionRecordByNode.get(node);
    },
    directReturnStatementsForFunction(node) {
      return directReturnsByFunctionNode.get(node) || [];
    },
    trustedGlobalReferencePath,
    hasUnshadowedStaticMutation(name) {
      const segments = String(name || "").split(".");
      while (segments.length) {
        if (mutatedUnshadowedStaticPaths.has(segments.join("."))) {
          return true;
        }
        segments.pop();
      }
      return false;
    },
    hasLexicalBinding(name, node) {
      const normalizedName = String(name || "");
      let scope = analysis.nodeScopes.get(node) || analysis.rootScope;
      while (scope) {
        if ((scope.declarations.get(normalizedName) || []).length) {
          return true;
        }
        scope = scope.parent;
      }
      return false;
    },
    isIdentityTransitionRecord(record) {
      return identityTransitionRecords.has(record);
    },
    forEachIdentityTransitionRecord(callback) {
      identityTransitionRecords.forEach(callback);
    },
    identityTransitionSourceExpressions(record) {
      return identityTransitionSourcesByRecord.get(record) || [];
    },
    functionIdentityContext,
  });
  if (
    typeof analysisInstrumentation
      ?.onCompleteBindingMutationAnalysisPreparation === "function"
  ) {
    analysisInstrumentation.onCompleteBindingMutationAnalysisPreparation({
      ancestorWalks: 1,
      fullWalks: invariantFullWalks,
    });
  }
  return context;
}

function getBindingMutationAnalysisContext(
  analysis,
  analysisInstrumentation = null,
) {
  if (
    analysisInstrumentation?.bindingMutationAnalysisContextMode
      === "fresh"
  ) {
    return prepareBindingMutationAnalysisContext(
      analysis,
      analysisInstrumentation,
    );
  }
  if (bindingMutationAnalysisContextByAnalysis.has(analysis)) {
    return bindingMutationAnalysisContextByAnalysis.get(analysis);
  }
  const context = prepareBindingMutationAnalysisContext(
    analysis,
    analysisInstrumentation,
  );
  bindingMutationAnalysisContextByAnalysis.set(analysis, context);
  return context;
}

function createActionDelegationEdge(
  source,
  filePath,
  binding,
  actionContract,
  node,
  enclosingFunctionIdentity,
) {
  const location = locationFromNode(node);
  const start = Number(node?.start || 0);
  const end = Number(node?.end || node?.start || 0);
  const sourceSlice = String(source || "")
    .slice(start, end)
    .replaceAll("\r\n", "\n")
    .trim();
  return {
    filePath: String(filePath || ""),
    bindingId: binding.id,
    bindingKind: binding.kind,
    root: binding.name,
    functionName: binding.functionName,
    parameterName: binding.parameterName,
    parameterIndex: binding.parameterIndex,
    parameterPath: binding.parameterPath,
    importSource: binding.importSource,
    importedName: binding.importedName,
    aliasSources: [...binding.aliasSources],
    aliasOperators: [...binding.aliasOperators],
    locator: binding.locator ? { ...binding.locator } : null,
    actionModulePath: actionContract.modulePath,
    actionExportName: actionContract.exportName,
    targetArgumentIndex: actionContract.targetArgumentIndex,
    enclosingFunctionIdentity: String(
      enclosingFunctionIdentity || "",
    ),
    start,
    end,
    ...location,
    sourceFingerprint: sourceSlice
      ? createHash("sha256").update(sourceSlice).digest("hex")
      : "",
  };
}

function rawRootIdentifier(expression) {
  let node = unwrapChain(expression);
  while (node?.type === "MemberExpression") {
    node = unwrapChain(node.object);
  }
  return node?.type === "Identifier" ? node : null;
}

function collectPatternTargets(pattern, results = []) {
  if (!pattern) {
    return results;
  }
  const node = unwrapChain(pattern);
  if (node?.type === "MemberExpression") {
    results.push(node);
    return results;
  }
  if (node?.type === "AssignmentPattern") {
    return collectPatternTargets(node.left, results);
  }
  if (node?.type === "RestElement") {
    return collectPatternTargets(node.argument, results);
  }
  if (node?.type === "ArrayPattern") {
    for (const element of node.elements || []) {
      collectPatternTargets(element, results);
    }
    return results;
  }
  if (node?.type === "ObjectPattern") {
    for (const property of node.properties || []) {
      if (property.type === "RestElement") {
        collectPatternTargets(property.argument, results);
      } else {
        collectPatternTargets(property.value, results);
      }
    }
  }
  return results;
}

function patternAliasEntries(pattern, baseReference, analysis) {
  if (pattern?.type !== "ObjectPattern") {
    return [];
  }
  const entries = [];
  for (const property of pattern.properties || []) {
    if (
      property.type !== "Property"
      || property.computed
      || property.value?.type !== "Identifier"
    ) {
      continue;
    }
    const key = staticPropertyName(property.key, property.computed);
    const record = analysis.resolveIdentifier(property.value);
    if (!key || !record) {
      continue;
    }
    entries.push({
      record,
      baseSegments: [
        ...baseReference.segments,
        { key, dynamic: false },
      ],
      aliasChain: [...baseReference.aliasChain, property.value.name],
    });
  }
  return entries;
}

function callName(node) {
  const callee = unwrapChain(node?.callee);
  if (
    callee?.type !== "MemberExpression"
    || callee.object?.type !== "Identifier"
  ) {
    return "";
  }
  const method = staticPropertyName(callee.property, callee.computed);
  return method ? `${callee.object.name}.${method}` : "";
}

function propertyArgument(argument) {
  const key = staticPropertyName(argument, true);
  return {
    key: key || "*",
    dynamic: !key,
  };
}

function processObjectMutationCall(
  event,
  filePath,
  binding,
  resolveReference,
) {
  const operation = OBJECT_MUTATION_OPERATIONS.get(callName(event));
  if (!operation || !event.arguments?.length) {
    return null;
  }
  const reference = resolveReference(event.arguments[0]);
  if (!reference) {
    return null;
  }
  let pathSegments = reference.segments.map((segment) => segment.key);
  let dynamic = reference.segments.some((segment) => segment.dynamic);
  if (
    [
      "define-property",
      "reflect-define-property",
      "reflect-set",
      "reflect-delete",
    ].includes(operation)
  ) {
    const property = propertyArgument(event.arguments[1]);
    pathSegments = [...pathSegments, property.key];
    dynamic = dynamic || property.dynamic;
  } else if (STRUCTURAL_TARGET_MUTATION_OPERATIONS.has(operation)) {
    if (!pathSegments.length) {
      pathSegments = ["*"];
      dynamic = true;
    }
  } else {
    pathSegments = [...pathSegments, "*"];
    dynamic = true;
  }
  return createFinding(filePath, binding, reference, operation, event, {
    key: pathSegments[0] || "*",
    pathSegments,
    dynamic,
  });
}

function processCollectionMutationCall(
  event,
  filePath,
  binding,
  resolveReference,
) {
  const callee = unwrapChain(event.callee);
  if (callee?.type !== "MemberExpression") {
    return null;
  }
  const reference = resolveReference(callee);
  const method = staticPropertyName(callee.property, callee.computed);
  if (
    !reference
    || reference.segments.length < 1
    || !COLLECTION_MUTATOR_METHODS.has(method)
  ) {
    return null;
  }
  const retainedSegments = reference.segments.slice(0, -1);
  const pathSegments = retainedSegments.map((segment) => segment.key);
  return createFinding(
    filePath,
    binding,
    {
      ...reference,
      segments: retainedSegments,
    },
    "collection-mutate",
    event,
    {
      key: pathSegments[0] || "*",
      pathSegments,
      dynamic:
        !retainedSegments.length
        || retainedSegments.some((segment) => segment.dynamic),
    },
  );
}

function processPatternMutations(
  pattern,
  event,
  filePath,
  binding,
  resolveReference,
) {
  const findings = [];
  for (const target of collectPatternTargets(pattern)) {
    const reference = resolveReference(target);
    if (!reference?.segments.length) {
      continue;
    }
    findings.push(
      createFinding(
        filePath,
        binding,
        reference,
        "destructure-assign",
        target,
      ),
    );
  }
  return findings;
}

function analyzeBindingMutations(
  analysis,
  binding,
  resolution,
  {
    filePath = "",
    source = "",
    derivedAliasTaintMode =
      DERIVED_ALIAS_TAINT_MODES.STRICT,
    analysisTraversalMode = "auto",
    analysisInstrumentation = null,
    recognizeCurrentContracts = true,
    getBindingMutationAnalysisContextForScan = null,
    getSourceBoundOwnerProofPreparationForScan = null,
  } = {},
) {
  const normalizedDerivedAliasTaintMode =
    normalizeDerivedAliasTaintMode(derivedAliasTaintMode);
  const strictDerivedAliasTaint =
    normalizedDerivedAliasTaintMode
    === DERIVED_ALIAS_TAINT_MODES.STRICT;
  if (resolution.issue) {
    return {
      findings: [
        createUnsupportedFinding(filePath, binding, {
          reason: resolution.issue,
          node: resolution.issueNode,
        }),
      ],
      actionDelegations: [],
    };
  }

  const findings = [];
  const diagnostics = [];
  const actionDelegations = [];
  const borrowedProjectionCallsWithReportedBorrowedArgument = new WeakSet();
  const bindingMutationAnalysisContext =
    getBindingMutationAnalysisContextForScan();
  const exportedFunctionNodes =
    bindingMutationAnalysisContext.deriveExportedFunctionNodes(
      resolution.targetRecords,
    );
  if (
    typeof analysisInstrumentation
      ?.onDeriveBindingMutationExportedFunctions === "function"
  ) {
    analysisInstrumentation.onDeriveBindingMutationExportedFunctions({
      bindingId: binding.id,
      functionNames: [...exportedFunctionNodes]
        .map((node) =>
          bindingMutationAnalysisContext.functionNameForNode(node)
        )
        .filter(Boolean),
    });
  }
  const resolvingLocalCallResultNodes = new Set();
  const functionIdentityContext =
    bindingMutationAnalysisContext.functionIdentityContext;
  const functionRecordForNode =
    bindingMutationAnalysisContext.functionRecordForNode;
  const directReturnStatementsForFunction =
    bindingMutationAnalysisContext.directReturnStatementsForFunction;
  const trustedGlobalReferencePath =
    bindingMutationAnalysisContext.trustedGlobalReferencePath;
  const hasUnshadowedStaticMutation =
    bindingMutationAnalysisContext.hasUnshadowedStaticMutation;
  const hasLexicalBinding =
    bindingMutationAnalysisContext.hasLexicalBinding;
  const isIdentityTransitionRecord =
    bindingMutationAnalysisContext.isIdentityTransitionRecord;
  const forEachIdentityTransitionRecord =
    bindingMutationAnalysisContext.forEachIdentityTransitionRecord;
  const identityTransitionSourceExpressions =
    bindingMutationAnalysisContext.identityTransitionSourceExpressions;

  function exactTrackedState(reference, record, aliasName = "") {
    const isConfiguredTarget = resolution.targetRecords.has(record);
    return {
      active: true,
      ambiguous: false,
      baseSegments: (reference?.segments || []).map((segment) => ({
        ...segment,
      })),
      aliasChain: isConfiguredTarget
        ? []
        : [...(reference?.aliasChain || []), aliasName].filter(Boolean),
    };
  }

  function noneTrackedState() {
    return {
      active: false,
      ambiguous: false,
      baseSegments: [],
      aliasChain: [],
    };
  }

  function maybeTrackedState() {
    return {
      active: false,
      ambiguous: true,
      baseSegments: [],
      aliasChain: [],
    };
  }

  function cloneTrackedState(state) {
    return {
      active: Boolean(state?.active),
      ambiguous: Boolean(state?.ambiguous),
      baseSegments: (state?.baseSegments || []).map((segment) => ({
        ...segment,
      })),
      aliasChain: [...(state?.aliasChain || [])],
    };
  }

  function cloneAliasRecords(aliasRecords) {
    // Tracked states are replaced, never mutated; branches own their Map while
    // sharing these scan-local values. Reference resolution copies path arrays.
    return new Map(aliasRecords);
  }

  function trackedStateStatus(state) {
    if (state?.ambiguous) {
      return "maybe";
    }
    return state?.active ? "exact" : "none";
  }

  function effectiveRecordState(aliasRecords, record) {
    if (!record) {
      return noneTrackedState();
    }
    const executionNode = currentExecutionFunction();
    const executionRecord = executionNode
      ? functionRecordForNode(executionNode)
      : null;
    if (
      executionRecord
      && !analysis.isScopeDescendant(record.scope, executionRecord.scope)
      && Number(record.ownerNode?.start || record.start || 0)
        > Number(executionNode.start || 0)
    ) {
      return maybeTrackedState();
    }
    if (aliasRecords.has(record)) {
      return aliasRecords.get(record);
    }
    return resolution.targetRecords.has(record)
      ? {
        active: true,
        ambiguous: false,
        baseSegments: [],
        aliasChain: [],
      }
      : noneTrackedState();
  }

  function trackedStateIdentity(state) {
    if (trackedStateStatus(state) !== "exact") {
      return trackedStateStatus(state);
    }
    return JSON.stringify(
      (state.baseSegments || []).map((segment) => ({
        key: segment.key,
        dynamic: Boolean(segment.dynamic),
      })),
    );
  }

  function mergeTrackedStates(states) {
    const normalized = states.map((state) => cloneTrackedState(state));
    const statuses = normalized.map(trackedStateStatus);
    if (statuses.every((status) => status === "none")) {
      return noneTrackedState();
    }
    if (
      statuses.every((status) => status === "exact")
      && normalized.every(
        (state) =>
          trackedStateIdentity(state) === trackedStateIdentity(normalized[0]),
      )
    ) {
      return cloneTrackedState(normalized[0]);
    }
    return maybeTrackedState();
  }

  function mergeAliasRecords(aliasRecordMaps) {
    const records = new Set(resolution.targetRecords);
    for (const aliasRecords of aliasRecordMaps) {
      for (const record of aliasRecords.keys()) {
        records.add(record);
      }
    }
    const merged = new Map();
    for (const record of records) {
      merged.set(
        record,
        mergeTrackedStates(
          aliasRecordMaps.map((aliasRecords) =>
            effectiveRecordState(aliasRecords, record)
          ),
        ),
      );
    }
    return merged;
  }

  function referenceClassification(expression, aliasRecords) {
    const node = unwrapChain(expression);
    if (!node) {
      return { status: "none", reference: null };
    }
    if (isSanctionedMutationDelegatingOwnerBindingRead(node)) {
      return { status: "none", reference: null };
    }
    if (isSanctionedMutationDelegatingOwnerMethodRead(node)) {
      return { status: "none", reference: null };
    }
    if (
      isSanctionedMutationDelegatingOwnerCompositionClosureRead(node)
      && !isImportedActionTargetNode(node)
    ) {
      return { status: "none", reference: null };
    }
    if (node.type === "AwaitExpression") {
      return referenceClassification(node.argument, aliasRecords);
    }
    if (node.type === "ConditionalExpression") {
      return mergeReferenceClassifications([
        referenceClassification(node.consequent, aliasRecords),
        referenceClassification(node.alternate, aliasRecords),
      ]);
    }
    if (node.type === "LogicalExpression") {
      return mergeReferenceClassifications([
        referenceClassification(node.left, aliasRecords),
        referenceClassification(node.right, aliasRecords),
      ]);
    }
    if (node.type === "SequenceExpression") {
      return referenceClassification(node.expressions.at(-1), aliasRecords);
    }
    if (node.type === "AssignmentExpression") {
      return referenceClassification(node.right, aliasRecords);
    }
    if (node.type === "CallExpression") {
      const importedDelegation = importedTargetDelegation(node);
      const borrowedProjectionResult =
        importedBorrowedProjectionResultClassification(
          node,
          aliasRecords,
          importedDelegation?.borrowedProjectionContract,
        );
      if (borrowedProjectionResult) {
        return borrowedProjectionResult;
      }
      const detachedCaptureContract =
        importedDelegation?.detachedCaptureContract;
      const targetArgument = detachedCaptureContract
        ? node.arguments?.[detachedCaptureContract.targetArgumentIndex]
        : null;
      if (targetArgument) {
        const targetClassification = referenceClassification(
          targetArgument,
          aliasRecords,
        );
        if (isSanctionedImportedStateActionTargetArgument(
          targetArgument,
          targetClassification,
          aliasRecords,
        )) {
          return { status: "none", reference: null };
        }
      }
      if (isSanctionedMutationDelegatingOwnerFactoryCall(node)) {
        return { status: "none", reference: null };
      }
      if (
        mutationDelegatingOwnerGetterContracts(node).length > 0
        && !isSanctionedMutationDelegatingOwnerGetterCall(node)
      ) {
        return { status: "maybe", reference: null };
      }
      if (isSanctionedMutationDelegatingOwnerGetterCall(node)) {
        return { status: "none", reference: null };
      }
      const mapReadResult = mapPrototypeGetCallResultClassification(
        node,
        aliasRecords,
      );
      if (mapReadResult) {
        return mapReadResult;
      }
    }
    if (
      strictDerivedAliasTaint
      && node.type === "CallExpression"
    ) {
      const localCallResult = localHelperCallResultClassification(
        node,
        aliasRecords,
      );
      if (localCallResult) {
        return localCallResult;
      }
    }
    if (
      strictDerivedAliasTaint
      && (
        node.type === "ObjectExpression"
        || node.type === "ArrayExpression"
      )
      && containerExpressionContainsTrackedReference(node, aliasRecords)
    ) {
      return { status: "maybe", reference: null };
    }
    const rootIdentifier = rawRootIdentifier(node);
    const rootRecord = analysis.resolveIdentifier(rootIdentifier);
    if (isImmutableFunctionRecord(rootRecord)) {
      return { status: "none", reference: null };
    }
    if (
      rootRecord
      && trackedStateStatus(effectiveRecordState(aliasRecords, rootRecord))
        === "maybe"
    ) {
      return { status: "maybe", reference: null };
    }
    const resolver = createReferenceResolver(
      analysis,
      binding,
      resolution,
      aliasRecords,
    );
    const reference = resolver.resolveReference(node);
    if (reference) {
      return { status: "exact", reference };
    }
    return { status: "none", reference: null };
  }

  function mergeReferenceClassifications(classifications) {
    const statuses = classifications.map(({ status }) => status);
    if (statuses.every((status) => status === "none")) {
      return { status: "none", reference: null };
    }
    if (
      statuses.every((status) => status === "exact")
      && classifications.every(
        ({ reference }) =>
          JSON.stringify(reference?.segments || [])
          === JSON.stringify(classifications[0]?.reference?.segments || []),
      )
    ) {
      return {
        status: "exact",
        reference: classifications[0].reference,
      };
    }
    return { status: "maybe", reference: null };
  }

  function containerExpressionContainsTrackedReference(
    expression,
    aliasRecords,
  ) {
    const node = unwrapChain(expression);
    if (!node) {
      return false;
    }
    if (node.type === "ObjectExpression") {
      return (node.properties || []).some((property) => {
        if (property.type !== "Property") {
          return false;
        }
        const classification = referenceClassification(
          property.value,
          aliasRecords,
        );
        return classification.status !== "none"
          || containerExpressionContainsTrackedReference(
            property.value,
            aliasRecords,
          );
      });
    }
    if (node.type === "ArrayExpression") {
      return (node.elements || []).some((element) => {
        if (!element) {
          return false;
        }
        const source = element.type === "SpreadElement"
          ? element.argument
          : element;
        const classification = referenceClassification(
          source,
          aliasRecords,
        );
        return classification.status !== "none"
          || containerExpressionContainsTrackedReference(
            source,
            aliasRecords,
          );
      });
    }
    if (node.type === "ConditionalExpression") {
      return containerExpressionContainsTrackedReference(
        node.consequent,
        aliasRecords,
      ) || containerExpressionContainsTrackedReference(
        node.alternate,
        aliasRecords,
      );
    }
    if (node.type === "LogicalExpression") {
      return containerExpressionContainsTrackedReference(
        node.left,
        aliasRecords,
      ) || containerExpressionContainsTrackedReference(
        node.right,
        aliasRecords,
      );
    }
    if (node.type === "SequenceExpression") {
      return containerExpressionContainsTrackedReference(
        node.expressions.at(-1),
        aliasRecords,
      );
    }
    return false;
  }

  function localHelperCallResultClassification(node, aliasRecords) {
    const helperNode = directImmutableLocalHelperNode(node);
    if (!helperNode) {
      return null;
    }
    if (resolvingLocalCallResultNodes.has(helperNode)) {
      return { status: "maybe", reference: null };
    }

    resolvingLocalCallResultNodes.add(helperNode);
    try {
      const helperState = cloneAliasRecords(aliasRecords);
      for (
        let parameterIndex = 0;
        parameterIndex < (helperNode.params || []).length;
        parameterIndex += 1
      ) {
        const parameter = helperNode.params[parameterIndex];
        const argument = node.arguments?.[parameterIndex] || null;
        transferPatternClassification(
          parameter,
          argument
            ? referenceClassification(argument, aliasRecords)
            : { status: "none", reference: null },
          argument,
          helperState,
          { preserveConfiguredTargets: true },
        );
      }

      const returnedExpressions = helperNode.type === "ArrowFunctionExpression"
        && helperNode.body?.type !== "BlockStatement"
        ? [helperNode.body]
        : directReturnStatementsForFunction(helperNode)
          .map((statement) => statement.argument)
          .filter(Boolean);
      if (!returnedExpressions.length) {
        return { status: "none", reference: null };
      }
      return mergeReferenceClassifications(
        returnedExpressions.map((returnedExpression) => {
          const classification = referenceClassification(
            returnedExpression,
            helperState,
          );
          if (classification.status !== "none") {
            return classification;
          }
          return containerExpressionContainsTrackedReference(
            returnedExpression,
            helperState,
          )
            ? { status: "maybe", reference: null }
            : classification;
        }),
      );
    } finally {
      resolvingLocalCallResultNodes.delete(helperNode);
    }
  }

  function identityTransitionMayReachTrackedState(
    record,
    aliasRecords,
    visitedRecords = new Set(),
  ) {
    if (visitedRecords.has(record)) {
      return false;
    }
    const nextVisitedRecords = new Set(visitedRecords);
    nextVisitedRecords.add(record);
    if (trackedStateStatus(effectiveRecordState(aliasRecords, record)) !== "none") {
      return true;
    }
    return identityTransitionSourceExpressions(record).some((source) => {
      const classification = referenceClassification(source, aliasRecords);
      if (
        classification.status !== "none"
        || containerExpressionContainsTrackedReference(source, aliasRecords)
      ) {
        return true;
      }
      const sourceRecord = analysis.resolveIdentifier(
        rawRootIdentifier(unwrapChain(source)),
      );
      if (sourceRecord?.kind === "parameter") {
        return !isSanctionedMutationDelegatingOwnerCompositionClosureRead(source);
      }
      return Boolean(
        sourceRecord
        && isIdentityTransitionRecord(sourceRecord)
        && identityTransitionMayReachTrackedState(
          sourceRecord,
          aliasRecords,
          nextVisitedRecords,
        )
      );
    });
  }

  function setRecordFromClassification(
    aliasRecords,
    record,
    aliasName,
    classification,
  ) {
    if (!record) {
      return;
    }
    if (classification.status === "exact") {
      aliasRecords.set(
        record,
        exactTrackedState(classification.reference, record, aliasName),
      );
      return;
    }
    aliasRecords.set(
      record,
      classification.status === "maybe"
        ? maybeTrackedState()
        : noneTrackedState(),
    );
  }

  function recordAmbiguousMutation(node) {
    diagnostics.push(
      createUnsupportedFinding(filePath, binding, {
        reason: "ambiguous-alias-flow",
        node,
      }),
    );
  }

  function recordClassificationDiagnostic(
    classification,
    node,
    reason,
    {
      referenceSegments = null,
      evidenceKind = "",
    } = {},
  ) {
    if (classification.status === "none") {
      return false;
    }
    if (classification.status === "exact") {
      const reference = classification.reference;
      const segments = referenceSegments || reference?.segments || [];
      diagnostics.push(
        createFinding(
          filePath,
          binding,
          {
            ...reference,
            segments,
          },
          "unsupported",
          node,
          {
            key: segments[0]?.key || "*",
            pathSegments: segments.length
              ? segments.map((segment) => segment.key)
              : ["*"],
            dynamic:
              !segments.length
              || segments.some((segment) => segment.dynamic),
            unsupported: true,
            reason,
            evidenceKind,
          },
        ),
      );
      return true;
    }
    diagnostics.push(
      createUnsupportedFinding(filePath, binding, {
        reason,
        node,
        evidenceKind,
      }),
    );
    return true;
  }

  function stateEscapeSourceExpression(expression) {
    const node = unwrapChain(expression);
    return node?.type === "SpreadElement"
      ? unwrapChain(node.argument)
      : node;
  }

  function recordExpressionAliasEscape(expression, aliasRecords) {
    const source = stateEscapeSourceExpression(expression);
    if (!source) {
      return false;
    }
    return recordClassificationDiagnostic(
      referenceClassification(source, aliasRecords),
      source,
      "state-alias-escape",
    );
  }

  function recordPatternSinkAliasEscape(
    target,
    classification,
    sourceExpression,
    aliasRecords,
  ) {
    const sink = unwrapChain(target);
    if (sink?.type !== "MemberExpression") {
      return false;
    }
    const sinkClassification = referenceClassification(sink, aliasRecords);
    if (sinkClassification.status !== "none") {
      return false;
    }
    const source = stateEscapeSourceExpression(sourceExpression) || sink;
    return recordClassificationDiagnostic(
      classification,
      source,
      "state-alias-escape",
      { evidenceKind: "assignment-value" },
    );
  }

  function unshadowedStaticCallName(node) {
    const name = rawUnshadowedStaticCallName(node);
    return name && !hasUnshadowedStaticMutation(name) ? name : "";
  }

  function rawUnshadowedStaticCallName(node) {
    const callee = unwrapChain(node?.callee);
    if (
      callee?.type !== "MemberExpression"
      || callee.object?.type !== "Identifier"
      || analysis.resolveIdentifier(callee.object)
    ) {
      return "";
    }
    const method = staticPropertyName(callee.property, callee.computed);
    return method ? `${callee.object.name}.${method}` : "";
  }

  function unshadowedIdentifierCallName(node) {
    const callee = unwrapChain(node?.callee);
    if (
      callee?.type !== "Identifier"
      || analysis.resolveIdentifier(callee)
      || hasUnshadowedStaticMutation(callee.name)
    ) {
      return "";
    }
    return callee.name;
  }

  function isKnownObjectMutationCall(node) {
    return OBJECT_MUTATION_OPERATIONS.has(unshadowedStaticCallName(node));
  }

  function isKnownMutationCall(
    node,
    receiverClassification = { status: "none", reference: null },
  ) {
    if (isKnownObjectMutationCall(node)) {
      return true;
    }
    const callee = unwrapChain(node?.callee);
    return callee?.type === "MemberExpression"
      && receiverClassification.status === "exact"
      && COLLECTION_MUTATOR_METHODS.has(
        staticPropertyName(callee.property, callee.computed),
      );
  }

  function isExactUnshadowedMapPrototypeGetCall(node) {
    if (
      node?.type !== "CallExpression"
      || node.optional === true
      || (node.arguments || []).length !== 2
    ) {
      return false;
    }
    const callMember = unwrapChain(node.callee);
    const getMember = unwrapChain(callMember?.object);
    const prototypeMember = unwrapChain(getMember?.object);
    const mapIdentifier = unwrapChain(prototypeMember?.object);
    if (
      callMember?.type !== "MemberExpression"
      || callMember.computed
      || callMember.optional === true
      || callMember.property?.type !== "Identifier"
      || callMember.property.name !== "call"
      || getMember?.type !== "MemberExpression"
      || getMember.computed
      || getMember.optional === true
      || getMember.property?.type !== "Identifier"
      || getMember.property.name !== "get"
      || prototypeMember?.type !== "MemberExpression"
      || prototypeMember.computed
      || prototypeMember.optional === true
      || prototypeMember.property?.type !== "Identifier"
      || prototypeMember.property.name !== "prototype"
      || mapIdentifier?.type !== "Identifier"
      || mapIdentifier.name !== "Map"
      || analysis.resolveIdentifier(mapIdentifier)
      || trustedGlobalReferencePath(callMember) !== "Map.prototype.get.call"
      || hasLexicalBinding("Function", node)
      || hasUnshadowedStaticMutation("Map.prototype.get.call")
      || hasUnshadowedStaticMutation("Function.prototype.call")
    ) {
      return false;
    }
    return true;
  }

  function mapPrototypeGetCallResultClassification(node, aliasRecords) {
    if (!isExactUnshadowedMapPrototypeGetCall(node)) {
      return null;
    }
    const targetClassification = referenceClassification(
      node.arguments[0],
      aliasRecords,
    );
    const targetSegments = targetClassification.reference?.segments || [];
    if (
      targetClassification.status !== "exact"
      || !targetSegments.length
      || targetSegments.some((segment) => segment.dynamic)
    ) {
      return null;
    }
    return {
      status: "exact",
      reference: {
        ...targetClassification.reference,
        segments: [
          ...targetSegments.map((segment) => ({ ...segment })),
          { key: "*", dynamic: true },
        ],
      },
    };
  }

  function isKnownPureReadCall(node) {
    const name = unshadowedStaticCallName(node);
    if (PURE_STATIC_STATE_READ_CALLS.has(name)) {
      return true;
    }
    return PURE_IDENTIFIER_STATE_READ_CALLS.has(
      unshadowedIdentifierCallName(node),
    );
  }

  function knownSafeTrackedArgumentIndexes(
    node,
    argumentClassifications,
    receiverClassification,
    aliasRecords,
  ) {
    const safeIndexes = new Set();
    if (node.type !== "CallExpression") {
      return safeIndexes;
    }
    if (mapPrototypeGetCallResultClassification(node, aliasRecords)) {
      safeIndexes.add(0);
      return safeIndexes;
    }
    const staticName = unshadowedStaticCallName(node);
    if (OBJECT_MUTATION_OPERATIONS.has(staticName)) {
      if (argumentClassifications[0]?.status === "exact") {
        safeIndexes.add(0);
      }
      return safeIndexes;
    }
    const pureStaticIndexes =
      PURE_STATIC_STATE_READ_ARGUMENT_INDEXES.get(staticName) || [];
    for (const index of pureStaticIndexes) {
      safeIndexes.add(index);
    }
    for (
      const index of
        PURE_IDENTIFIER_STATE_READ_ARGUMENT_INDEXES.get(
          unshadowedIdentifierCallName(node),
        ) || []
    ) {
      safeIndexes.add(index);
    }
    if (
      isKnownMutationCall(node, receiverClassification)
      && !isKnownObjectMutationCall(node)
    ) {
      for (let index = 0; index < argumentClassifications.length; index += 1) {
        safeIndexes.add(index);
      }
    }
    return safeIndexes;
  }

  function recordUnknownCallMutation(
    node,
    receiverClassification,
  ) {
    if (
      isKnownMutationCall(node, receiverClassification)
      || isKnownPureReadCall(node)
    ) {
      return;
    }
    recordTrackedReceiverMutation(node, receiverClassification);
  }

  function recordTrackedReceiverMutation(node, receiverClassification) {
    if (receiverClassification.status !== "none") {
      recordClassificationDiagnostic(
        receiverClassification,
        node,
        "unsupported-call-mutation",
      );
    }
  }

  function recordUnknownArgumentEscapes(
    node,
    argumentClassifications,
    {
      receiverClassification = { status: "none", reference: null },
      skippedArgumentIndexes = new Set(),
      aliasRecords = new Map(),
    } = {},
  ) {
    const safeIndexes = knownSafeTrackedArgumentIndexes(
      node,
      argumentClassifications,
      receiverClassification,
      aliasRecords,
    );
    for (let index = 0; index < argumentClassifications.length; index += 1) {
      if (
        skippedArgumentIndexes.has(index)
        || safeIndexes.has(index)
      ) {
        continue;
      }
      recordClassificationDiagnostic(
        argumentClassifications[index],
        node.arguments[index] || node,
        "state-alias-escape",
        { evidenceKind: "unknown-call-argument" },
      );
    }
  }

  function resolveMutationReference(expression, aliasRecords, node = expression) {
    const classification = referenceClassification(expression, aliasRecords);
    if (classification.status === "maybe") {
      recordAmbiguousMutation(node);
      return null;
    }
    return classification.status === "exact"
      ? classification.reference
      : null;
  }

  function setPatternRecordStates(
    pattern,
    aliasRecords,
    classification,
    { configuredDeclarationOwner = null } = {},
  ) {
    for (const identifier of collectPatternIdentifiers(pattern)) {
      const record = analysis.resolveIdentifier(identifier);
      if (
        configuredDeclarationOwner
        && resolution.targetRecords.has(record)
        && record?.ownerNode === configuredDeclarationOwner
      ) {
        continue;
      }
      setRecordFromClassification(
        aliasRecords,
        record,
        identifier.name,
        classification,
      );
    }
  }

  function processEvent(event, aliasRecords) {
    const resolveReference = (expression) =>
      resolveMutationReference(expression, aliasRecords, expression);

    if (event.type === "VariableDeclarator") {
      if (!event.init) {
        return;
      }
      const classification = referenceClassification(event.init, aliasRecords);
      if (event.id.type === "Identifier") {
        const record = analysis.resolveIdentifier(event.id);
        if (
          resolution.targetRecords.has(record)
          && record?.ownerNode === event
        ) {
          return;
        }
        setRecordFromClassification(
          aliasRecords,
          record,
          event.id.name,
          classification,
        );
        return;
      }
      if (
        event.id.type === "ObjectPattern"
        && classification.status === "exact"
      ) {
        for (
          const entry of patternAliasEntries(
            event.id,
            classification.reference,
            analysis,
          )
        ) {
          if (
            resolution.targetRecords.has(entry.record)
            && entry.record?.ownerNode === event
          ) {
            continue;
          }
          aliasRecords.set(entry.record, {
            active: true,
            ambiguous: false,
            baseSegments: entry.baseSegments,
            aliasChain: entry.aliasChain,
          });
        }
        return;
      }
      setPatternRecordStates(
        event.id,
        aliasRecords,
        classification,
        { configuredDeclarationOwner: event },
      );
      return;
    }

    if (
      event.type === "AssignmentExpression"
      && event.left.type === "Identifier"
    ) {
      const record = analysis.resolveIdentifier(event.left);
      if (!record) {
        return;
      }
      if (event.operator === "=") {
        setRecordFromClassification(
          aliasRecords,
          record,
          event.left.name,
          referenceClassification(event.right, aliasRecords),
        );
        return;
      }
      if (LOGICAL_ASSIGNMENT_OPERATORS.has(event.operator)) {
        const retained = effectiveRecordState(aliasRecords, record);
        const replacement = referenceClassification(event.right, aliasRecords);
        const replacementState = replacement.status === "exact"
          ? exactTrackedState(replacement.reference, record, event.left.name)
          : replacement.status === "maybe"
            ? maybeTrackedState()
            : noneTrackedState();
        aliasRecords.set(
          record,
          mergeTrackedStates([retained, replacementState]),
        );
        return;
      }
      aliasRecords.set(record, noneTrackedState());
      return;
    }

    if (event.type === "AssignmentExpression") {
      if (event.left.type === "MemberExpression") {
        const reference = resolveMutationReference(
          event.left,
          aliasRecords,
          event.left,
        );
        if (reference?.segments.length) {
          findings.push(
            createFinding(
              filePath,
              binding,
              reference,
              event.operator === "=" ? "assign" : "compound-assign",
              event.left,
            ),
          );
        }
      } else {
        findings.push(
          ...processPatternMutations(
            event.left,
            event,
            filePath,
            binding,
            resolveReference,
          ),
        );
      }
      return;
    }

    if (event.type === "UpdateExpression") {
      if (event.argument.type === "Identifier") {
        const record = analysis.resolveIdentifier(event.argument);
        if (record) {
          aliasRecords.set(record, noneTrackedState());
        }
        return;
      }
      const reference = resolveMutationReference(
        event.argument,
        aliasRecords,
        event,
      );
      if (reference?.segments.length) {
        findings.push(
          createFinding(filePath, binding, reference, "update", event),
        );
      }
      return;
    }

    if (event.type === "UnaryExpression" && event.operator === "delete") {
      const reference = resolveMutationReference(
        event.argument,
        aliasRecords,
        event,
      );
      if (reference?.segments.length) {
        findings.push(
          createFinding(filePath, binding, reference, "delete", event),
        );
      }
      return;
    }

    if (event.type === "CallExpression") {
      const objectFinding = isKnownObjectMutationCall(event)
        ? processObjectMutationCall(
          event,
          filePath,
          binding,
          resolveReference,
        )
        : null;
      if (objectFinding) {
        findings.push(objectFinding);
        return;
      }
      const collectionFinding = processCollectionMutationCall(
        event,
        filePath,
        binding,
        resolveReference,
      );
      if (collectionFinding) {
        findings.push(collectionFinding);
      }
      return;
    }

    if (event.type === "ForInStatement" || event.type === "ForOfStatement") {
      if (event.left.type !== "VariableDeclaration") {
        findings.push(
          ...processPatternMutations(
            event.left,
            event,
            filePath,
            binding,
            resolveReference,
          ),
        );
      }
    }
  }

  const executionFunctionStack = [null];
  const actionProofReachabilityStack = [true];
  const tryStateCollectors = [];

  function currentExecutionFunction() {
    return executionFunctionStack.at(-1) || null;
  }

  function currentActionProofReachability() {
    return actionProofReachabilityStack.at(-1) === true;
  }

  function recordPotentialThrow(aliasRecords) {
    const collector = tryStateCollectors.at(-1);
    if (collector?.owner === currentExecutionFunction()) {
      collector.states.push(cloneAliasRecords(aliasRecords));
    }
  }

  function processFunction(
    node,
    aliasRecords,
    {
      parameterClassifications = [],
      actionProofReachable =
        currentActionProofReachability(),
    } = {},
  ) {
    const functionState = cloneAliasRecords(aliasRecords);
    const functionRecord = functionRecordForNode(node);
    if (
      typeof analysisInstrumentation?.onProcessFunction === "function"
    ) {
      analysisInstrumentation.onProcessFunction({
        bindingId: binding.id,
        functionName: functionRecord?.name || "",
        start: Number(node?.start || 0),
        end: Number(node?.end || node?.start || 0),
      });
    }
    if (functionRecord) {
      forEachIdentityTransitionRecord((record) => {
        if (
          !analysis.isScopeDescendant(record.scope, functionRecord.scope)
          && identityTransitionMayReachTrackedState(record, functionState)
        ) {
          functionState.set(record, maybeTrackedState());
        }
      });
    }
    executionFunctionStack.push(node);
    actionProofReachabilityStack.push(
      Boolean(actionProofReachable),
    );
    try {
      for (
        let parameterIndex = 0;
        parameterIndex < (node.params || []).length;
        parameterIndex += 1
      ) {
        const parameter = node.params[parameterIndex];
        processPatternExpressions(parameter, functionState);
        transferPatternClassification(
          parameter,
          parameterClassifications[parameterIndex]
            || { status: "none", reference: null },
          null,
          functionState,
          { preserveConfiguredTargets: true },
        );
      }
      if (
        node.type === "ArrowFunctionExpression"
        && node.body?.type !== "BlockStatement"
      ) {
        processExpression(node.body, functionState);
        recordClassificationDiagnostic(
          referenceClassification(node.body, functionState),
          node.body,
          "state-alias-escape",
          { evidenceKind: "return-value" },
        );
      } else {
        processStatement(node.body, functionState);
      }
    } finally {
      actionProofReachabilityStack.pop();
      executionFunctionStack.pop();
    }
  }

  function directImmutableLocalHelperNode(callNode) {
    const callee = unwrapChain(callNode?.callee);
    if (callee?.type !== "Identifier") {
      return null;
    }
    const record = analysis.resolveIdentifier(callee);
    if (
      !record
      || isIdentityTransitionRecord(record)
      || IMPORTED_COMPAT_TARGET_HELPERS.has(record.name)
    ) {
      return null;
    }
    if (
      isImmutableFunctionRecord(record)
      && record.ownerNode?.type === "FunctionDeclaration"
    ) {
      return record.ownerNode;
    }
    if (
      record.kind === "variable"
      && record.declarationKind === "const"
      && isFunctionNode(record.init)
      && Number(record.ownerNode?.end || 0) <= Number(callNode.start || 0)
    ) {
      return record.init;
    }
    return null;
  }

  function resolveProjectLocalImportPath(importSource) {
    const source = String(importSource || "").replaceAll("\\", "/");
    if (!source.startsWith("./") && !source.startsWith("../")) {
      return "";
    }
    const importer = String(filePath || "").replaceAll("\\", "/");
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(importer), source),
    );
    if (
      !resolved
      || resolved === ".."
      || resolved.startsWith("../")
      || path.posix.isAbsolute(resolved)
    ) {
      return "";
    }
    return resolved.replace(/^\.\//, "");
  }

  function importedTargetDelegation(callNode) {
    if (!recognizeCurrentContracts) {
      return null;
    }
    const callee = unwrapChain(callNode?.callee);
    if (
      callee?.type !== "Identifier"
      || callNode?.optional === true
      || callee.optional === true
    ) {
      return null;
    }
    const record = analysis.resolveIdentifier(callee);
    if (
      record?.kind !== "import"
      || record.importKind !== "ImportSpecifier"
      || isIdentityTransitionRecord(record)
    ) {
      return null;
    }
    const source = resolveProjectLocalImportPath(record.importSource);
    const actionContract =
      findStateActionDelegationContractEntry(
        source,
        record.importedName,
      );
    if (actionContract) {
      return {
        targetArgumentIndex: actionContract.targetArgumentIndex,
        actionContract,
      };
    }
    const detachedCaptureContract =
      findStateDetachedCaptureContractEntry(
        source,
        record.importedName,
      );
    if (detachedCaptureContract) {
      return {
        targetArgumentIndex: detachedCaptureContract.targetArgumentIndex,
        actionContract: null,
        detachedCaptureContract,
      };
    }
    const readOnlyContract =
      findStateActionReadOnlyContractEntry(
        source,
        record.importedName,
      );
    if (readOnlyContract) {
      return {
        targetArgumentIndex: readOnlyContract.targetArgumentIndex,
        actionContract: null,
      };
    }
    const borrowedProjectionContract =
      findStateImportedBorrowedProjectionContractEntry(
        source,
        record.importedName,
      );
    if (borrowedProjectionContract) {
      return {
        targetArgumentIndex:
          borrowedProjectionContract.copiedArgumentIndex,
        actionContract: null,
        borrowedProjectionContract,
      };
    }
    const pureNormalizerContract =
      findStateImportedPureNormalizerContractEntry(
        source,
        record.importedName,
      );
    if (pureNormalizerContract) {
      return {
        targetArgumentIndex:
          pureNormalizerContract.targetArgumentIndex,
        actionContract: null,
        pureNormalizerContract,
      };
    }
    const importedPureReaderContract =
      findStateImportedPureReaderContractEntry(
        source,
        record.importedName,
      );
    if (
      importedPureReaderContract
      && (callNode.arguments || []).length
        === importedPureReaderContract.importedArgumentCount
      && !(callNode.arguments || []).some(
        (argument) => unwrapChain(argument)?.type === "SpreadElement",
      )
    ) {
      return {
        targetArgumentIndex:
          importedPureReaderContract.targetParameterIndex,
        actionContract: null,
        importedPureReaderContract,
      };
    }
    if (source === "js/core/state/index.js") {
      const targetArgumentIndex =
        IMPORTED_COMPAT_TARGET_HELPERS.get(record.importedName);
      return Number.isInteger(targetArgumentIndex)
        ? { targetArgumentIndex, actionContract: null }
        : null;
    }
    return null;
  }

  function processSafeTargetDelegation(
    node,
    argumentClassifications,
    aliasRecords,
  ) {
    const delegatedArgumentIndexes = new Set();
    if (node.type !== "CallExpression") {
      return delegatedArgumentIndexes;
    }

    const importedDelegation = importedTargetDelegation(node);
    if (importedDelegation) {
      const importedTargetIndex = importedDelegation.targetArgumentIndex;
      const targetClassification =
        argumentClassifications[importedTargetIndex];
      const initiallySanctionedTarget =
        importedDelegation.borrowedProjectionContract
          ? isSanctionedImportedBorrowedProjectionCall(
            node,
            argumentClassifications,
            importedDelegation.borrowedProjectionContract,
          )
          : importedDelegation.pureNormalizerContract
            ? isSanctionedImportedPureNormalizerTargetArgument(
              node.arguments[importedTargetIndex],
              targetClassification,
              importedDelegation.pureNormalizerContract,
            )
            : importedDelegation.importedPureReaderContract
              ? importedDelegation.importedPureReaderContract.allowBorrowedTarget
                ? ["exact", "maybe"].includes(targetClassification?.status)
                : isDirectStateRootArgument(
                  unwrapChain(node.arguments[importedTargetIndex]),
                  targetClassification,
                )
            : importedDelegation.detachedCaptureContract
              ? isSanctionedImportedDetachedCaptureTargetArgument(
                node.arguments[importedTargetIndex],
                targetClassification,
                importedDelegation.detachedCaptureContract,
              )
              : isSanctionedImportedStateActionTargetArgument(
                node.arguments[importedTargetIndex],
                targetClassification,
                aliasRecords,
              );
      const callerActionContract = currentActionDelegationContract();
      const exactCurrentActionTarget = isExactCurrentActionTargetArgument(
        node.arguments[importedTargetIndex],
      );
      const sanctionedTarget = Boolean(
        initiallySanctionedTarget
        && (!callerActionContract || exactCurrentActionTarget),
      );
      const sanctionedReferenceIdentityTarget = Boolean(
        importedDelegation.actionContract
        && exactCurrentActionTarget
        && (
          importedDelegation.actionContract
            .referenceIdentityArgumentIndexes || []
        ).some((argumentIndex) => {
          const argument = node.arguments[argumentIndex];
          const payload = unwrapChain(argument);
          return argumentIndex < node.arguments.length
            && (
              isSanctionedImportedStateActionReferenceIdentityArgument(
                argument,
                argumentIndex,
                importedDelegation.actionContract,
                aliasRecords,
              )
              || (
                (
                  payload?.type === "ObjectExpression"
                  || payload?.type === "ArrayExpression"
                )
                && isSafeRegisteredActionPayloadContainer(
                  payload,
                  aliasRecords,
                )
              )
            );
        }),
      );
      if (
        importedTargetIndex < node.arguments.length
        && (sanctionedTarget || sanctionedReferenceIdentityTarget)
      ) {
        delegatedArgumentIndexes.add(importedTargetIndex);
        if (importedDelegation.actionContract) {
          for (
            let argumentIndex = importedTargetIndex + 1;
            argumentIndex < node.arguments.length;
            argumentIndex += 1
          ) {
            const argument = unwrapChain(node.arguments[argumentIndex]);
            if (
              (
                argument?.type === "ObjectExpression"
                || argument?.type === "ArrayExpression"
              )
              && isSafeRegisteredActionPayloadContainer(
                argument,
                aliasRecords,
              )
            ) {
              delegatedArgumentIndexes.add(argumentIndex);
            }
          }
          for (
            const argumentIndex of
              importedDelegation.actionContract.readOnlyArgumentIndexes || []
          ) {
            if (
              argumentIndex < node.arguments.length
              && isSanctionedImportedStateActionReadOnlyArgument(
                node.arguments[argumentIndex],
                argumentIndex,
                argumentClassifications[argumentIndex],
                importedDelegation.actionContract,
                aliasRecords,
              )
            ) {
              delegatedArgumentIndexes.add(argumentIndex);
            }
          }
          for (
            const argumentIndex of
              importedDelegation.actionContract
                .referenceIdentityArgumentIndexes || []
          ) {
            if (
              argumentIndex < node.arguments.length
              && isSanctionedImportedStateActionReferenceIdentityArgument(
                node.arguments[argumentIndex],
                argumentIndex,
                importedDelegation.actionContract,
                aliasRecords,
              )
            ) {
              delegatedArgumentIndexes.add(argumentIndex);
            }
          }
        }
        if (
          importedDelegation.actionContract
          && currentActionProofReachability()
        ) {
          actionDelegations.push(
            createActionDelegationEdge(
              source,
              filePath,
              binding,
              importedDelegation.actionContract,
              node,
              functionIdentityContext.identityForFunctionNode(
                currentExecutionFunction(),
              ),
            ),
          );
        }
      }
      return delegatedArgumentIndexes;
    }

    const helperNode = directImmutableLocalHelperNode(node);
    if (!helperNode || executionFunctionStack.includes(helperNode)) {
      return delegatedArgumentIndexes;
    }
    const isSourceBoundMutationDelegatingOwnerGetter =
      mutationDelegatingOwnerGetterContracts(node).length > 0;
    const parameterClassifications = [];
    for (
      let index = 0;
      index < argumentClassifications.length;
      index += 1
    ) {
      const classification = argumentClassifications[index];
      if (
        isSourceBoundMutationDelegatingOwnerGetter
        && classification.status === "maybe"
        && helperNode.params?.[index]?.type === "Identifier"
        && isImmutableStateRootUnionArgument(node.arguments[index], aliasRecords)
      ) {
        delegatedArgumentIndexes.add(index);
        continue;
      }
      if (
        !isExplicitTargetArgument(node.arguments[index])
        ||
        classification.status !== "exact"
        || helperNode.params?.[index]?.type !== "Identifier"
      ) {
        continue;
      }
      delegatedArgumentIndexes.add(index);
      parameterClassifications[index] = classification;
    }
    if (
      (
        delegatedArgumentIndexes.size
        || currentActionProofReachability()
      )
      && !(
        isSourceBoundMutationDelegatingOwnerGetter
        && delegatedArgumentIndexes.size === 0
      )
    ) {
      processFunction(helperNode, aliasRecords, {
        parameterClassifications,
        actionProofReachable:
          currentActionProofReachability(),
      });
    }
    return delegatedArgumentIndexes;
  }

  function isDirectStateRootArgument(argument, classification) {
    return Boolean(
      argument?.type === "Identifier"
      && classification?.status === "exact"
      && classification.reference?.segments?.length === 0,
    );
  }

  function stateRootUnionShape(
    expression,
    aliasRecords,
    visitedRecords = new Set(),
  ) {
    const node = unwrapChain(expression);
    if (!node) return { valid: true, hasRoot: false };
    if (node.type === "LogicalExpression") {
      const left = stateRootUnionShape(
        node.left,
        aliasRecords,
        visitedRecords,
      );
      const right = stateRootUnionShape(
        node.right,
        aliasRecords,
        visitedRecords,
      );
      return {
        valid: left.valid && right.valid,
        hasRoot: left.hasRoot || right.hasRoot,
      };
    }
    if (node.type === "ConditionalExpression") {
      const consequent = stateRootUnionShape(
        node.consequent,
        aliasRecords,
        visitedRecords,
      );
      const alternate = stateRootUnionShape(
        node.alternate,
        aliasRecords,
        visitedRecords,
      );
      return {
        valid: consequent.valid && alternate.valid,
        hasRoot: consequent.hasRoot || alternate.hasRoot,
      };
    }
    if (node.type === "SequenceExpression") {
      return stateRootUnionShape(
        node.expressions.at(-1),
        aliasRecords,
        visitedRecords,
      );
    }

    const classification = referenceClassification(node, aliasRecords);
    if (classification.status === "exact") {
      const isRoot = (classification.reference?.segments || []).length === 0;
      return { valid: isRoot, hasRoot: isRoot };
    }
    if (classification.status === "none") {
      return { valid: true, hasRoot: false };
    }
    if (node.type !== "Identifier") {
      return { valid: false, hasRoot: false };
    }
    const record = analysis.resolveIdentifier(node);
    if (
      record?.kind !== "variable"
      || record.declarationKind !== "const"
      || !record.init
      || isIdentityTransitionRecord(record)
      || visitedRecords.has(record)
    ) {
      return { valid: false, hasRoot: false };
    }
    const nextVisitedRecords = new Set(visitedRecords);
    nextVisitedRecords.add(record);
    return stateRootUnionShape(
      record.init,
      aliasRecords,
      nextVisitedRecords,
    );
  }

  function isImmutableStateRootUnionArgument(argument, aliasRecords) {
    const node = unwrapChain(argument);
    if (node?.type !== "Identifier") return false;
    const shape = stateRootUnionShape(node, aliasRecords);
    return shape.valid && shape.hasRoot;
  }

  function isSanctionedImportedStateActionTargetArgument(
    argument,
    classification,
    aliasRecords,
  ) {
    if (isDirectStateRootArgument(argument, classification)) {
      return true;
    }
    if (isImmutableStateRootUnionArgument(argument, aliasRecords)) {
      return true;
    }
    const node = unwrapChain(argument);
    if (
      node?.type !== "Identifier"
      || classification?.status !== "maybe"
    ) {
      return false;
    }
    const record = analysis.resolveIdentifier(node);
    if (
      record?.kind !== "parameter"
      || record.parameterPath !== "$"
      || isIdentityTransitionRecord(record)
    ) {
      return false;
    }
    const parameter =
      record.ownerNode?.params?.[record.parameterIndex];
    if (
      parameter?.type !== "AssignmentPattern"
      || parameter.left?.type !== "Identifier"
      || analysis.resolveIdentifier(parameter.left) !== record
    ) {
      return false;
    }
    const defaultClassification = referenceClassification(
      parameter.right,
      aliasRecords,
    );
    return Boolean(
      defaultClassification.status === "exact"
      && defaultClassification.reference?.segments?.length === 0,
    );
  }

  function mutationDelegatingOwnerFactoryContractForCall(callNode) {
    const callee = unwrapChain(callNode?.callee);
    if (callee?.type !== "Identifier" || callNode.optional === true) return null;
    const record = analysis.resolveIdentifier(callee);
    if (
      record?.kind !== "import"
      || record.importKind !== "ImportSpecifier"
      || isIdentityTransitionRecord(record)
    ) return null;
    return findStateMutationDelegatingOwnerFactoryContractEntry(
      resolveProjectLocalImportPath(record.importSource),
      record.importedName,
    );
  }

  function isSanctionedMutationDelegatingOwnerFactoryCall(callNode) {
    if (!recognizeCurrentContracts) return false;
    const contract = mutationDelegatingOwnerFactoryContractForCall(callNode);
    const ownerFunction = currentExecutionFunction();
    if (
      !contract
      || String(filePath || "").replaceAll("\\", "/").replace(/^\.\//, "")
        !== contract.compositionModulePath
      || ownerFunction?.id?.name !== contract.compositionExportName
    ) return false;
    const ownerSource = String(source || "")
      .slice(ownerFunction.start, ownerFunction.end)
      .trim();
    return createHash("sha256").update(ownerSource).digest("hex")
      === contract.compositionSourceFingerprint;
  }

  function mutationDelegatingOwnerContractsForCurrentModule() {
    if (!recognizeCurrentContracts) return [];
    const normalizedFilePath = String(filePath || "")
      .replaceAll("\\", "/")
      .replace(/^\.\//, "");
    return STATE_MUTATION_DELEGATING_OWNER_CONTRACT.filter(
      ({ compositionModulePath }) => compositionModulePath === normalizedFilePath,
    );
  }

  function hasExactMutationDelegatingOwnerCompositionFunction(
    contract,
    functionNode,
  ) {
    if (
      !contract
      || String(filePath || "").replaceAll("\\", "/").replace(/^\.\//, "")
        !== contract.compositionModulePath
      || functionNode?.id?.name !== contract.compositionExportName
    ) return false;
    return createHash("sha256")
      .update(String(source || "").slice(functionNode.start, functionNode.end).trim())
      .digest("hex") === contract.compositionSourceFingerprint;
  }

  function hasSingleSanctionedMutationDelegatingOwnerFactoryCall(
    contract,
    compositionFunction,
  ) {
    let sanctionedFactoryCallCount = 0;
    walk.full(compositionFunction.body, (node) => {
      if (
        node.type === "CallExpression"
        && mutationDelegatingOwnerFactoryContractForCall(node) === contract
      ) sanctionedFactoryCallCount += 1;
    });
    return sanctionedFactoryCallCount === 1;
  }

  function isSanctionedMutationDelegatingOwnerBindingRead(node) {
    if (node?.type !== "Identifier") return false;
    return mutationDelegatingOwnerContractsForCurrentModule().some((contract) => (
      node.name === contract.ownerBindingName
      && hasExactMutationDelegatingOwnerCompositionFunction(
        contract,
        currentExecutionFunction(),
      )
      && hasSingleSanctionedMutationDelegatingOwnerFactoryCall(
        contract,
        currentExecutionFunction(),
      )
    ));
  }

  function isSanctionedMutationDelegatingOwnerCompositionClosureRead(expression) {
    // Identity-transition analysis can inspect a callback outside its execution
    // frame. Use the lexical owner so those reads obey the same source receipt.
    let enclosingFunction = expression;
    while (enclosingFunction && !isFunctionNode(enclosingFunction)) {
      enclosingFunction = analysis.parentNodeForNode(enclosingFunction);
    }
    if (!enclosingFunction) return false;
    let compositionFunction = enclosingFunction;
    let functionRecord = functionRecordForNode(compositionFunction);
    let parentScope = functionRecord?.parentScope || null;
    while (parentScope) {
      if (isFunctionNode(parentScope.node)) {
        compositionFunction = parentScope.node;
      }
      parentScope = parentScope.parent;
    }
    if (compositionFunction === enclosingFunction) return false;
    return mutationDelegatingOwnerContractsForCurrentModule().some((contract) => {
      if (!hasExactMutationDelegatingOwnerCompositionFunction(
        contract,
        compositionFunction,
      )) return false;
      return hasSingleSanctionedMutationDelegatingOwnerFactoryCall(
        contract,
        compositionFunction,
      );
    });
  }

  function mutationDelegatingOwnerGetterContracts(node) {
    if (node?.type !== "CallExpression" || node.callee?.type !== "Identifier") {
      return [];
    }
    const ownerGetter = directImmutableLocalHelperNode(node);
    return mutationDelegatingOwnerContractsForCurrentModule().filter((contract) => (
      hasExactMutationDelegatingOwnerCompositionFunction(contract, ownerGetter)
      && hasSingleSanctionedMutationDelegatingOwnerFactoryCall(
        contract,
        ownerGetter,
      )
    ));
  }

  function isImportedActionTargetNode(node) {
    const parent = analysis.parentNodeForNode(node);
    if (parent?.type !== "CallExpression") return false;
    const delegation = importedTargetDelegation(parent);
    const targetIndex = delegation?.actionContract?.targetArgumentIndex;
    return Number.isInteger(targetIndex)
      && unwrapChain(parent.arguments?.[targetIndex]) === node;
  }

  function isSanctionedMutationDelegatingOwnerGetterCall(node) {
    let member = analysis.parentNodeForNode(node);
    if (member?.type === "VariableDeclarator" && member.init === node) {
      const declaration = analysis.parentNodeForNode(member);
      const pattern = member.id;
      if (declaration?.kind !== "const" || pattern?.type !== "ObjectPattern") {
        return false;
      }
      return mutationDelegatingOwnerGetterContracts(node).some((contract) => (
        pattern.properties.length > 0
        && pattern.properties.every((property) => (
          property.type === "Property"
          && !property.computed
          && property.value?.type === "Identifier"
          && contract.methods.includes(staticPropertyName(property.key, false))
        ))
      ));
    }
    if (member?.type === "ChainExpression") {
      member = analysis.parentNodeForNode(member);
    }
    const delegatingMethodName = member?.type === "MemberExpression"
      && unwrapChain(member.object) === node
      ? staticPropertyName(member.property, member.computed)
      : "";
    return mutationDelegatingOwnerGetterContracts(node).some(
      (contract) => contract.methods.includes(delegatingMethodName),
    );
  }

  function isSanctionedImportedPureNormalizerTargetArgument(
    argument,
    classification,
    contractEntry,
  ) {
    const node = unwrapChain(argument);
    if (
      node?.type !== "MemberExpression"
      || classification?.status !== "exact"
    ) {
      return false;
    }
    const segments = classification.reference?.segments || [];
    const expectedKeys = String(
      contractEntry?.targetArgumentStaticPath || "",
    ).split(".").filter(Boolean);
    return Boolean(
      expectedKeys.length
      && segments.length === expectedKeys.length
      && segments.every(
        (segment, index) =>
          !segment.dynamic && segment.key === expectedKeys[index],
      )
    );
  }

  function isSanctionedMutationDelegatingOwnerMethodRead(node) {
    const identifier = node?.type === "CallExpression" ? node.callee : node;
    if (identifier?.type !== "Identifier") return false;
    const record = analysis.resolveIdentifier(identifier);
    return record?.kind === "variable"
      && record.declarationKind === "const"
      && !isIdentityTransitionRecord(record)
      && record.ownerNode?.id?.type === "ObjectPattern"
      && record.init?.type === "CallExpression"
      && isSanctionedMutationDelegatingOwnerGetterCall(record.init);
  }

  function isSanctionedImportedBorrowedProjectionArgument(
    argument,
    classification,
    staticPath,
  ) {
    const node = unwrapChain(argument);
    if (
      node?.type !== "MemberExpression"
      || classification?.status !== "exact"
    ) {
      return false;
    }
    const expectedKeys = String(staticPath || "")
      .split(".").filter(Boolean);
    const segments = classification.reference?.segments || [];
    return Boolean(
      expectedKeys.length
      && segments.length === expectedKeys.length
      && segments.every(
        (segment, index) =>
          !segment.dynamic && segment.key === expectedKeys[index],
      ),
    );
  }

  function isSanctionedImportedBorrowedProjectionCall(
    node,
    argumentClassifications,
    contractEntry,
  ) {
    if (
      node?.type !== "CallExpression"
      || node.optional === true
      || !Number.isInteger(contractEntry?.argumentCount)
      || (node.arguments || []).length !== contractEntry.argumentCount
      || (node.arguments || []).some(
        (argument) => argument?.type === "SpreadElement",
      )
    ) {
      return false;
    }
    const copiedArgumentIndex = contractEntry.copiedArgumentIndex;
    const borrowedArgumentIndex = contractEntry.borrowedArgumentIndex;
    const sanctioned = Boolean(
      Number.isInteger(copiedArgumentIndex)
      && Number.isInteger(borrowedArgumentIndex)
      && isSanctionedImportedBorrowedProjectionArgument(
        node.arguments[copiedArgumentIndex],
        argumentClassifications[copiedArgumentIndex],
        contractEntry.copiedArgumentStaticPath,
      )
      && isSanctionedImportedBorrowedProjectionArgument(
        node.arguments[borrowedArgumentIndex],
        argumentClassifications[borrowedArgumentIndex],
        contractEntry.borrowedArgumentStaticPath,
      ),
    );
    return sanctioned;
  }

  function importedBorrowedProjectionResultClassification(
    node,
    aliasRecords,
    contractEntry,
  ) {
    if (!contractEntry) {
      return null;
    }
    const argumentClassifications = (node.arguments || []).map((argument) =>
      referenceClassification(argument, aliasRecords)
    );
    if (!isSanctionedImportedBorrowedProjectionCall(
      node,
      argumentClassifications,
      contractEntry,
    )) {
      return null;
    }
    return childReferenceClassification(
      argumentClassifications[contractEntry.borrowedArgumentIndex],
      "*",
      true,
    );
  }

  function isSanctionedImportedDetachedCaptureTargetArgument(
    argument,
    classification,
    contractEntry,
  ) {
    const expectedKeys = String(
      contractEntry?.targetArgumentStaticPath || "",
    ).split(".").filter(Boolean);
    if (!expectedKeys.length) {
      return isDirectStateRootArgument(argument, classification);
    }
    const node = unwrapChain(argument);
    const segments = classification?.reference?.segments || [];
    return Boolean(
      node?.type === "MemberExpression"
      && classification?.status === "exact"
      && segments.length === expectedKeys.length
      && segments.every(
        (segment, index) =>
          !segment.dynamic && segment.key === expectedKeys[index],
      )
    );
  }

  function isSanctionedImportedStateActionReadOnlyArgument(
    argument,
    argumentIndex,
    classification,
    actionContract,
    aliasRecords,
  ) {
    if (!actionContract?.readOnlyArgumentIndexes?.includes(argumentIndex)) {
      return false;
    }
    if (classification?.status === "exact") {
      const segments = classification.reference?.segments || [];
      return Boolean(
        segments.length > 0
        && segments.every((segment) => !segment.dynamic),
      );
    }

    let node = unwrapChain(argument);
    let segmentCount = 0;
    while (node?.type === "MemberExpression") {
      if (
        node.computed
        && !(
          node.property?.type === "Literal"
          && ["string", "number"].includes(typeof node.property.value)
        )
        && !(
          node.property?.type === "TemplateLiteral"
          && (node.property.expressions || []).length === 0
        )
      ) {
        return false;
      }
      segmentCount += 1;
      node = unwrapChain(node.object);
    }
    return Boolean(
      segmentCount > 0
      && isImmutableStateRootUnionArgument(node, aliasRecords),
    );
  }

  function isSanctionedImportedStateActionReferenceIdentityArgument(
    argument,
    argumentIndex,
    actionContract,
    aliasRecords,
  ) {
    if (
      binding?.kind !== "function-parameter"
      || !actionContract?.referenceIdentityArgumentIndexes?.includes(
        argumentIndex,
      )
    ) {
      return false;
    }
    let node = unwrapChain(argument);
    const classification = referenceClassification(node, aliasRecords);
    if (
      classification.status !== "exact"
      || (classification.reference?.segments || []).some(
        (segment) => segment.dynamic,
      )
    ) {
      return false;
    }
    while (node?.type === "MemberExpression") {
      if (
        node.computed
        && !(
          node.property?.type === "Literal"
          && ["string", "number"].includes(typeof node.property.value)
        )
        && !(
          node.property?.type === "TemplateLiteral"
          && (node.property.expressions || []).length === 0
        )
      ) {
        return false;
      }
      node = unwrapChain(node.object);
    }
    if (node?.type !== "Identifier") return false;
    return true;
  }

  function isExactCurrentActionTargetArgument(argument) {
    const node = unwrapChain(argument);
    if (node?.type !== "Identifier") return false;
    const executionRecord = functionRecordForNode(
      currentExecutionFunction(),
    );
    if (!executionRecord) return false;
    const callerContract = currentActionDelegationContract();
    if (!callerContract) return false;
    const targetRecord = executionRecord.parameterRecords.find(
      (record) =>
        record.parameterIndex === callerContract.targetArgumentIndex
        && record.parameterPath === "$",
    );
    return Boolean(
      targetRecord
      && analysis.resolveIdentifier(node) === targetRecord,
    );
  }

  function currentActionDelegationContract() {
    const executionRecord = functionRecordForNode(
      currentExecutionFunction(),
    );
    return executionRecord
      ? findStateActionDelegationContractEntry(
        filePath,
        executionRecord.name,
      )
      : null;
  }

  function isExplicitTargetArgument(argument) {
    const node = unwrapChain(argument);
    return Boolean(
      node
      && node.type !== "SpreadElement"
      && node.type !== "AwaitExpression",
    );
  }

  function isSafeRegisteredActionPayloadContainer(argument, aliasRecords) {
    const root = unwrapChain(argument);
    if (
      root?.type !== "ObjectExpression"
      && root?.type !== "ArrayExpression"
    ) {
      return false;
    }

    const emptyShape = () => ({
      tracked: false,
      mayBeRoot: false,
      dynamic: false,
      invalid: false,
    });

    function mergeShapes(shapes, { preserveRoot = true } = {}) {
      return {
        tracked: shapes.some((shape) => shape.tracked),
        mayBeRoot: preserveRoot
          && shapes.some((shape) => shape.mayBeRoot),
        dynamic: shapes.some((shape) => shape.dynamic),
        invalid: shapes.some((shape) => shape.invalid),
      };
    }

    function payloadExpressionShape(
      expression,
      visitedRecords = new Set(),
    ) {
      const node = unwrapChain(expression);
      if (!node) return emptyShape();
      if (node.type === "ObjectExpression") {
        const shapes = [];
        for (const property of node.properties || []) {
          if (property.type === "SpreadElement") {
            const spreadShape = payloadExpressionShape(
              property.argument,
              visitedRecords,
            );
            shapes.push({
              ...spreadShape,
              invalid: spreadShape.invalid
                || spreadShape.mayBeRoot
                || spreadShape.dynamic,
            });
            continue;
          }
          if (property.computed) {
            const keyShape = payloadExpressionShape(
              property.key,
              visitedRecords,
            );
            shapes.push({
              ...keyShape,
              invalid: keyShape.invalid || keyShape.tracked,
            });
          }
          const valueShape = payloadExpressionShape(
            property.value,
            visitedRecords,
          );
          shapes.push({
            ...valueShape,
            invalid: valueShape.invalid
              || valueShape.mayBeRoot
              || valueShape.dynamic,
          });
        }
        return mergeShapes(shapes, { preserveRoot: false });
      }
      if (node.type === "ArrayExpression") {
        const shapes = (node.elements || []).filter(Boolean).map((element) => {
          const spread = element.type === "SpreadElement";
          const valueShape = payloadExpressionShape(
            spread ? element.argument : element,
            visitedRecords,
          );
          return {
            ...valueShape,
            invalid: valueShape.invalid
              || valueShape.mayBeRoot
              || valueShape.dynamic,
          };
        });
        return mergeShapes(shapes, { preserveRoot: false });
      }
      if (node.type === "SpreadElement") {
        return payloadExpressionShape(node.argument, visitedRecords);
      }
      if (node.type === "LogicalExpression") {
        return mergeShapes([
          payloadExpressionShape(node.left, visitedRecords),
          payloadExpressionShape(node.right, visitedRecords),
        ]);
      }
      if (node.type === "ConditionalExpression") {
        const testShape = payloadExpressionShape(node.test, visitedRecords);
        const resultShape = mergeShapes([
          payloadExpressionShape(node.consequent, visitedRecords),
          payloadExpressionShape(node.alternate, visitedRecords),
        ]);
        return {
          tracked: testShape.tracked || resultShape.tracked,
          mayBeRoot: resultShape.mayBeRoot,
          dynamic: testShape.dynamic || resultShape.dynamic,
          invalid: testShape.invalid || resultShape.invalid,
        };
      }
      if (node.type === "SequenceExpression") {
        const shapes = (node.expressions || []).map((item) =>
          payloadExpressionShape(item, visitedRecords)
        );
        const resultShape = shapes.at(-1) || emptyShape();
        return {
          tracked: shapes.some((shape) => shape.tracked),
          mayBeRoot: resultShape.mayBeRoot,
          dynamic: shapes.some((shape) => shape.dynamic),
          invalid: shapes.some((shape) => shape.invalid),
        };
      }
      if (node.type === "MemberExpression") {
        const objectShape = payloadExpressionShape(
          node.object,
          visitedRecords,
        );
        const propertyShape = node.computed
          ? payloadExpressionShape(node.property, visitedRecords)
          : emptyShape();
        const classification = referenceClassification(node, aliasRecords);
        const referenceSegments = classification.status === "exact"
          ? classification.reference?.segments || []
          : [];
        const tracked = objectShape.tracked
          || propertyShape.tracked
          || classification.status !== "none";
        const hasStaticComputedProperty = !node.computed
          || (
            node.property?.type === "Literal"
            && ["string", "number"].includes(typeof node.property.value)
          )
          || (
            node.property?.type === "TemplateLiteral"
            && (node.property.expressions || []).length === 0
          );
        const dynamic = objectShape.dynamic
          || propertyShape.dynamic
          || (
            node.computed
            && !hasStaticComputedProperty
            && tracked
            && (
              classification.status !== "exact"
              || referenceSegments.length === 0
              || referenceSegments[0]?.dynamic
              || propertyShape.tracked
            )
          );
        return {
          tracked,
          mayBeRoot: false,
          dynamic,
          invalid: objectShape.invalid || propertyShape.invalid,
        };
      }
      if (
        node.type === "CallExpression"
        || node.type === "NewExpression"
      ) {
        const classification = referenceClassification(node, aliasRecords);
        if (classification.status === "exact") {
          const segments = classification.reference?.segments || [];
          return {
            tracked: true,
            mayBeRoot: segments.length === 0,
            dynamic: Boolean(segments[0]?.dynamic),
            invalid: false,
          };
        }
        if (classification.status === "maybe") {
          return {
            tracked: true,
            mayBeRoot: true,
            dynamic: false,
            invalid: false,
          };
        }
        if (
          node.type === "CallExpression"
          && unshadowedStaticCallName(node) === "Reflect.get"
        ) {
          const targetShape = payloadExpressionShape(
            node.arguments?.[0],
            visitedRecords,
          );
          if (targetShape.tracked) {
            const property = propertyArgument(node.arguments?.[1]);
            const propertyShape = payloadExpressionShape(
              node.arguments?.[1],
              visitedRecords,
            );
            return {
              tracked: true,
              mayBeRoot: property.dynamic,
              dynamic:
                targetShape.dynamic
                || property.dynamic
                || propertyShape.tracked,
              invalid: targetShape.invalid || propertyShape.invalid,
            };
          }
        }
        const calleeShape = payloadExpressionShape(
          node.callee,
          visitedRecords,
        );
        const argumentShapes = (node.arguments || []).map((item) =>
          payloadExpressionShape(
            item.type === "SpreadElement" ? item.argument : item,
            visitedRecords,
          )
        );
        const inputShape = mergeShapes([calleeShape, ...argumentShapes]);
        return {
          tracked: inputShape.tracked,
          mayBeRoot: inputShape.mayBeRoot,
          dynamic: inputShape.dynamic,
          invalid: inputShape.invalid,
        };
      }
      if (node.type === "AwaitExpression") {
        return payloadExpressionShape(node.argument, visitedRecords);
      }
      if (
        node.type === "BinaryExpression"
        || node.type === "UnaryExpression"
        || node.type === "TemplateLiteral"
      ) {
        const childShapes = childNodes(node).map(({ node: child }) =>
          payloadExpressionShape(child, visitedRecords)
        );
        const inputShape = mergeShapes(childShapes);
        return {
          tracked: inputShape.tracked,
          mayBeRoot: false,
          dynamic: inputShape.dynamic,
          invalid: inputShape.invalid
            || (node.type === "UnaryExpression" && node.operator === "delete"),
        };
      }

      const classification = referenceClassification(node, aliasRecords);
      if (classification.status === "exact") {
        const segments = classification.reference?.segments || [];
        return {
          tracked: true,
          mayBeRoot: segments.length === 0,
          dynamic: Boolean(segments[0]?.dynamic),
          invalid: false,
        };
      }
      if (classification.status === "maybe") {
        if (node.type === "Identifier") {
          const record = analysis.resolveIdentifier(node);
          if (
            record?.kind === "variable"
            && record.declarationKind === "const"
            && record.init
            && !isIdentityTransitionRecord(record)
            && !visitedRecords.has(record)
          ) {
            const nextVisitedRecords = new Set(visitedRecords);
            nextVisitedRecords.add(record);
            return payloadExpressionShape(record.init, nextVisitedRecords);
          }
        }
        return {
          tracked: true,
          mayBeRoot: true,
          dynamic: false,
          invalid: false,
        };
      }
      if (
        node.type === "AssignmentExpression"
        || node.type === "UpdateExpression"
        || node.type === "YieldExpression"
        || node.type === "TaggedTemplateExpression"
      ) {
        return {
          ...emptyShape(),
          invalid: true,
        };
      }
      return emptyShape();
    }

    const shape = payloadExpressionShape(root);
    return !shape.mayBeRoot && !shape.dynamic && !shape.invalid;
  }

  function processPatternExpressions(pattern, aliasRecords) {
    if (!pattern) {
      return aliasRecords;
    }
    if (pattern.type === "AssignmentPattern") {
      processExpression(pattern.right, aliasRecords);
      return processPatternExpressions(pattern.left, aliasRecords);
    }
    if (pattern.type === "RestElement") {
      return processPatternExpressions(pattern.argument, aliasRecords);
    }
    if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements || []) {
        processPatternExpressions(element, aliasRecords);
      }
      return aliasRecords;
    }
    if (pattern.type === "ObjectPattern") {
      for (const property of pattern.properties || []) {
        if (property.type === "RestElement") {
          processPatternExpressions(property.argument, aliasRecords);
          continue;
        }
        if (property.computed) {
          processExpression(property.key, aliasRecords);
        }
        processPatternExpressions(property.value, aliasRecords);
      }
    }
    return aliasRecords;
  }

  function processExpression(
    expression,
    aliasRecords,
    {
      suppressContainerEscape = false,
      actionProofReachable = null,
      sanctionedMutationDelegatingOwnerFactoryStateObject = false,
    } = {},
  ) {
    const node = unwrapChain(expression);
    if (!node) {
      return aliasRecords;
    }
    if (isFunctionNode(node)) {
      processFunction(node, aliasRecords, {
        actionProofReachable:
          actionProofReachable === null
            ? currentActionProofReachability()
            : Boolean(actionProofReachable),
      });
      return aliasRecords;
    }
    if (node.type === "ConditionalExpression") {
      const testedState = processExpression(node.test, aliasRecords);
      const consequentState = processExpression(
        node.consequent,
        cloneAliasRecords(testedState),
      );
      const alternateState = processExpression(
        node.alternate,
        cloneAliasRecords(testedState),
      );
      return replaceAliasRecords(
        aliasRecords,
        mergeAliasRecords([consequentState, alternateState]),
      );
    }
    if (node.type === "LogicalExpression") {
      const leftState = processExpression(node.left, aliasRecords);
      const rightState = processExpression(
        node.right,
        cloneAliasRecords(leftState),
      );
      return replaceAliasRecords(
        aliasRecords,
        mergeAliasRecords([leftState, rightState]),
      );
    }
    if (node.type === "SequenceExpression") {
      for (const item of node.expressions || []) {
        processExpression(item, aliasRecords);
      }
      return aliasRecords;
    }
    if (node.type === "AssignmentExpression") {
      if (node.left.type === "Identifier") {
        processExpression(node.right, aliasRecords);
        if (
          node.operator !== "="
          && !LOGICAL_ASSIGNMENT_OPERATORS.has(node.operator)
        ) {
          recordPotentialThrow(aliasRecords);
        }
        processEvent(node, aliasRecords);
        recordPotentialThrow(aliasRecords);
        return aliasRecords;
      }
      if (node.left.type === "MemberExpression") {
        processAssignmentTargetExpressions(node.left, aliasRecords);
        const targetClassification = referenceClassification(
          node.left,
          aliasRecords,
        );
        processEvent(node, aliasRecords);
        processExpression(node.right, aliasRecords);
        if (targetClassification.status === "none") {
          recordClassificationDiagnostic(
            referenceClassification(node.right, aliasRecords),
            node.right,
            "state-alias-escape",
            { evidenceKind: "assignment-value" },
          );
        }
        recordPotentialThrow(aliasRecords);
        return aliasRecords;
      }
      processExpression(node.right, aliasRecords, {
        suppressContainerEscape: true,
      });
      processAssignmentTargetExpressions(node.left, aliasRecords);
      recordPotentialThrow(aliasRecords);
      transferPatternIdentity(node.left, node.right, aliasRecords);
      processEvent(node, aliasRecords);
      recordPotentialThrow(aliasRecords);
      return aliasRecords;
    }
    if (node.type === "UpdateExpression") {
      processExpression(node.argument, aliasRecords);
      recordPotentialThrow(aliasRecords);
      processEvent(node, aliasRecords);
      recordPotentialThrow(aliasRecords);
      return aliasRecords;
    }
    if (node.type === "UnaryExpression") {
      processExpression(node.argument, aliasRecords);
      if (node.operator === "delete") {
        processEvent(node, aliasRecords);
      }
      return aliasRecords;
    }
    if (node.type === "CallExpression" || node.type === "NewExpression") {
      processExpression(node.callee, aliasRecords);
      const callee = unwrapChain(node.callee);
      const receiverClassification = callee?.type === "MemberExpression"
        ? referenceClassification(callee.object, aliasRecords)
        : { status: "none", reference: null };
      if (node.type === "CallExpression") {
        processEvent(node, aliasRecords);
      }
      const importedDelegation = node.type === "CallExpression"
        ? importedTargetDelegation(node)
        : null;
      const sanctionedMutationDelegatingOwnerFactoryCall =
        node.type === "CallExpression"
        && isSanctionedMutationDelegatingOwnerFactoryCall(node);
      let sanctionedImportedActionTarget = false;
      const argumentClassifications = [];
      for (
        let argumentIndex = 0;
        argumentIndex < (node.arguments || []).length;
        argumentIndex += 1
      ) {
        const argument = node.arguments[argumentIndex];
        const payloadNode = unwrapChain(argument);
        const isImportedActionPayloadContainer = Boolean(
          importedDelegation?.actionContract
          && sanctionedImportedActionTarget
          && argumentIndex !== importedDelegation.targetArgumentIndex
          && (
            payloadNode?.type === "ObjectExpression"
            || payloadNode?.type === "ArrayExpression"
          ),
        );
        const isSafeImportedActionPayloadContainer = Boolean(
          isImportedActionPayloadContainer
          && isSafeRegisteredActionPayloadContainer(
            payloadNode,
            aliasRecords,
          ),
        );
        processExpression(argument, aliasRecords, {
          suppressContainerEscape: Boolean(
            importedDelegation?.actionContract
            && sanctionedImportedActionTarget,
          ),
          sanctionedMutationDelegatingOwnerFactoryStateObject: Boolean(
            sanctionedMutationDelegatingOwnerFactoryCall
            && argumentIndex === 0
            && payloadNode?.type === "ObjectExpression",
          ),
        });
        if (
          isImportedActionPayloadContainer
          && !isSafeImportedActionPayloadContainer
        ) {
          recordClassificationDiagnostic(
            { status: "maybe", reference: null },
            argument,
            "state-alias-escape",
            { evidenceKind: "unknown-call-argument" },
          );
        }
        const argumentSource = stateEscapeSourceExpression(argument);
        const classification = referenceClassification(
          argumentSource,
          aliasRecords,
        );
        argumentClassifications.push(classification);
        if (
          importedDelegation?.actionContract
          && argumentIndex === importedDelegation.targetArgumentIndex
        ) {
          const callerActionContract = currentActionDelegationContract();
          const exactCurrentActionTarget =
            isExactCurrentActionTargetArgument(argument);
          sanctionedImportedActionTarget = Boolean(
            (
              isSanctionedImportedStateActionTargetArgument(
                argument,
                classification,
                aliasRecords,
              )
              && (!callerActionContract || exactCurrentActionTarget)
            )
            || (
              importedDelegation.actionContract
                .referenceIdentityArgumentIndexes?.length
              && exactCurrentActionTarget
            )
          );
        }
      }
      const delegatedArgumentIndexes = processSafeTargetDelegation(
        node,
        argumentClassifications,
        aliasRecords,
      );
      if (
        sanctionedMutationDelegatingOwnerFactoryCall
        && unwrapChain(node.arguments?.[0])?.type === "ObjectExpression"
      ) {
        delegatedArgumentIndexes.add(0);
      }
      if (node.type === "CallExpression") {
        recordUnknownCallMutation(
          node,
          receiverClassification,
        );
      }
      recordUnknownArgumentEscapes(node, argumentClassifications, {
        receiverClassification,
        skippedArgumentIndexes: delegatedArgumentIndexes,
        aliasRecords,
      });
      const borrowedProjectionContract =
        importedDelegation?.borrowedProjectionContract;
      if (
        borrowedProjectionContract
        && isSanctionedImportedBorrowedProjectionCall(
          node,
          argumentClassifications,
          borrowedProjectionContract,
        )
        && argumentClassifications[
          borrowedProjectionContract.borrowedArgumentIndex
        ]?.status !== "none"
        && !delegatedArgumentIndexes.has(
          borrowedProjectionContract.borrowedArgumentIndex,
        )
      ) {
        borrowedProjectionCallsWithReportedBorrowedArgument.add(node);
      }
      recordPotentialThrow(aliasRecords);
      return aliasRecords;
    }
    if (node.type === "MemberExpression") {
      processExpression(node.object, aliasRecords);
      if (node.computed) {
        processExpression(node.property, aliasRecords);
      }
      recordPotentialThrow(aliasRecords);
      return aliasRecords;
    }
    if (node.type === "ObjectExpression") {
      for (const property of node.properties || []) {
        if (property.type === "SpreadElement") {
          processExpression(property.argument, aliasRecords, {
            suppressContainerEscape,
          });
          if (!suppressContainerEscape) {
            recordClassificationDiagnostic(
              referenceClassification(property.argument, aliasRecords),
              property.argument,
              "state-alias-escape",
            );
          }
          continue;
        }
        if (property.computed) {
          processExpression(property.key, aliasRecords);
        }
        processExpression(property.value, aliasRecords, {
          suppressContainerEscape,
        });
        const sanctionedFactoryStateProperty = Boolean(
          sanctionedMutationDelegatingOwnerFactoryStateObject
          && property.type === "Property"
          && !property.computed
          && property.kind === "init"
          && !property.method
          && ["state", "runtimeState"].includes(staticPropertyName(property.key, property.computed))
          && unwrapChain(property.value)?.type === "Identifier"
          && (() => {
            const classification = referenceClassification(
              property.value,
              aliasRecords,
            );
            return classification.status === "exact"
              && (classification.reference?.segments || []).length === 0;
          })()
        );
        if (!suppressContainerEscape && !sanctionedFactoryStateProperty) {
          recordClassificationDiagnostic(
            referenceClassification(property.value, aliasRecords),
            property.value,
            "state-alias-escape",
          );
        }
      }
      return aliasRecords;
    }
    if (node.type === "ArrayExpression") {
      for (const element of node.elements || []) {
        processExpression(element, aliasRecords, {
          suppressContainerEscape,
        });
        if (element && !suppressContainerEscape) {
          recordExpressionAliasEscape(element, aliasRecords);
        }
      }
      return aliasRecords;
    }
    if (node.type === "TemplateLiteral") {
      for (const item of node.expressions || []) {
        processExpression(item, aliasRecords);
      }
      return aliasRecords;
    }
    if (node.type === "TaggedTemplateExpression") {
      processExpression(node.tag, aliasRecords);
      const tag = unwrapChain(node.tag);
      if (tag?.type === "MemberExpression") {
        recordTrackedReceiverMutation(
          node,
          referenceClassification(tag.object, aliasRecords),
        );
      }
      for (const item of node.quasi?.expressions || []) {
        processExpression(item, aliasRecords);
        recordExpressionAliasEscape(item, aliasRecords);
      }
      return aliasRecords;
    }
    if (node.type === "PropertyDefinition") {
      if (node.computed) {
        processExpression(node.key, aliasRecords);
      }
      processExpression(node.value, aliasRecords);
      recordExpressionAliasEscape(node.value, aliasRecords);
      return aliasRecords;
    }
    if (
      node.type === "AwaitExpression"
      || node.type === "YieldExpression"
      || node.type === "SpreadElement"
    ) {
      processExpression(node.argument, aliasRecords);
      if (node.type === "AwaitExpression") {
        recordPotentialThrow(aliasRecords);
      } else if (node.type === "YieldExpression") {
        recordClassificationDiagnostic(
          referenceClassification(node.argument, aliasRecords),
          node.argument || node,
          "state-alias-escape",
        );
      }
      return aliasRecords;
    }
    for (const child of childNodes(node)) {
      processExpression(child.node, aliasRecords);
    }
    return aliasRecords;
  }

  function processAssignmentTargetExpressions(target, aliasRecords) {
    const node = unwrapChain(target);
    if (!node || node.type === "Identifier") {
      return aliasRecords;
    }
    if (node.type === "MemberExpression") {
      processExpression(node.object, aliasRecords);
      if (node.computed) {
        processExpression(node.property, aliasRecords);
      }
      return aliasRecords;
    }
    if (node.type === "AssignmentPattern") {
      processExpression(node.right, aliasRecords);
      return processAssignmentTargetExpressions(node.left, aliasRecords);
    }
    if (node.type === "RestElement") {
      return processAssignmentTargetExpressions(node.argument, aliasRecords);
    }
    if (node.type === "ArrayPattern") {
      for (const element of node.elements || []) {
        processAssignmentTargetExpressions(element, aliasRecords);
      }
      return aliasRecords;
    }
    if (node.type === "ObjectPattern") {
      for (const property of node.properties || []) {
        if (property.type === "RestElement") {
          processAssignmentTargetExpressions(property.argument, aliasRecords);
          continue;
        }
        if (property.computed) {
          processExpression(property.key, aliasRecords);
        }
        processAssignmentTargetExpressions(property.value, aliasRecords);
      }
    }
    return aliasRecords;
  }

  function childReferenceClassification(classification, key, dynamic = false) {
    if (classification.status !== "exact") {
      return {
        status: classification.status,
        reference: null,
      };
    }
    return {
      status: "exact",
      reference: {
        ...classification.reference,
        segments: [
          ...(classification.reference?.segments || []),
          { key: String(key), dynamic: Boolean(dynamic) },
        ],
      },
    };
  }

  function transferPatternClassification(
    pattern,
    classification,
    sourceExpression,
    aliasRecords,
    {
      preserveConfiguredTargets = false,
      sourceExpressions = null,
    } = {},
  ) {
    const node = unwrapChain(pattern);
    const source = unwrapChain(sourceExpression);
    const sources = Array.isArray(sourceExpressions)
      ? sourceExpressions.map(unwrapChain).filter(Boolean)
      : source
        ? [source]
        : [];
    if (!node) {
      return;
    }
    if (node.type === "Identifier") {
      const record = analysis.resolveIdentifier(node);
      if (preserveConfiguredTargets && resolution.targetRecords.has(record)) {
        return;
      }
      setRecordFromClassification(
        aliasRecords,
        record,
        node.name,
        classification,
      );
      return;
    }
    if (node.type === "MemberExpression") {
      recordPatternSinkAliasEscape(
        node,
        classification,
        sourceExpression,
        aliasRecords,
      );
      return;
    }
    if (node.type === "AssignmentPattern") {
      const defaultClassification = referenceClassification(
        node.right,
        aliasRecords,
      );
      transferPatternClassification(
        node.left,
        mergeReferenceClassifications([
          classification,
          defaultClassification,
        ]),
        sourceExpression,
        aliasRecords,
        { preserveConfiguredTargets, sourceExpressions: sources },
      );
      return;
    }
    if (node.type === "RestElement") {
      transferPatternClassification(
        node.argument,
        classification.status === "none"
          ? classification
          : { status: "maybe", reference: null },
        null,
        aliasRecords,
        { preserveConfiguredTargets },
      );
      return;
    }
    if (node.type === "ArrayPattern") {
      for (let index = 0; index < node.elements.length; index += 1) {
        const element = node.elements[index];
        if (!element) {
          continue;
        }
        const sourceElements = sources
          .map((candidate) =>
            candidate.type === "ArrayExpression"
              ? candidate.elements[index]
              : null
          )
          .filter(Boolean);
        const elementClassification = sources.length
          ? mergeReferenceClassifications(
            sources.map((candidate) => {
              if (
                candidate.type === "ArrayExpression"
                && candidate.elements[index]
              ) {
                return referenceClassification(
                  candidate.elements[index],
                  aliasRecords,
                );
              }
              return childReferenceClassification(
                referenceClassification(candidate, aliasRecords),
                index,
              );
            }),
          )
          : childReferenceClassification(classification, index);
        transferPatternClassification(
          element,
          elementClassification,
          sourceElements.length === 1 ? sourceElements[0] : null,
          aliasRecords,
          {
            preserveConfiguredTargets,
            sourceExpressions: sourceElements,
          },
        );
      }
      return;
    }
    if (node.type === "ObjectPattern") {
      for (const property of node.properties || []) {
        if (property.type === "RestElement") {
          transferPatternClassification(
            property.argument,
            classification.status === "none"
              ? classification
              : { status: "maybe", reference: null },
            null,
            aliasRecords,
            { preserveConfiguredTargets },
          );
          continue;
        }
        const key = staticPropertyName(property.key, property.computed);
        const sourceProperties = sources
          .map((candidate) =>
            candidate.type === "ObjectExpression"
              ? (candidate.properties || []).find(
                (sourceProperty) =>
                  sourceProperty.type === "Property"
                  && staticPropertyName(
                    sourceProperty.key,
                    sourceProperty.computed,
                  ) === key,
              )?.value
              : null
          )
          .filter(Boolean);
        const propertyClassification = sources.length
          ? mergeReferenceClassifications(
            sources.map((candidate) => {
              if (candidate.type === "ObjectExpression") {
                const sourceProperty = (candidate.properties || []).find(
                  (entry) =>
                    entry.type === "Property"
                    && staticPropertyName(entry.key, entry.computed) === key,
                );
                return sourceProperty
                  ? referenceClassification(
                    sourceProperty.value,
                    aliasRecords,
                  )
                  : { status: "none", reference: null };
              }
              return childReferenceClassification(
                referenceClassification(candidate, aliasRecords),
                key || "*",
                !key,
              );
            }),
          )
          : childReferenceClassification(
            classification,
            key || "*",
            !key,
          );
        transferPatternClassification(
          property.value,
          propertyClassification,
          sourceProperties.length === 1 ? sourceProperties[0] : null,
          aliasRecords,
          {
            preserveConfiguredTargets,
            sourceExpressions: sourceProperties,
          },
        );
      }
    }
  }

  function transferPatternIdentity(
    pattern,
    sourceExpression,
    aliasRecords,
    options = {},
  ) {
    transferPatternClassification(
      pattern,
      referenceClassification(sourceExpression, aliasRecords),
      sourceExpression,
      aliasRecords,
      options,
    );
  }

  function replaceAliasRecords(target, replacement) {
    target.clear();
    for (const [record, state] of replacement) {
      target.set(record, cloneTrackedState(state));
    }
    return target;
  }

  function aliasRecordsEqual(left, right) {
    const records = new Set([
      ...resolution.targetRecords,
      ...left.keys(),
      ...right.keys(),
    ]);
    for (const record of records) {
      const leftState = effectiveRecordState(left, record);
      const rightState = effectiveRecordState(right, record);
      if (
        trackedStateStatus(leftState) !== trackedStateStatus(rightState)
        || trackedStateIdentity(leftState) !== trackedStateIdentity(rightState)
      ) {
        return false;
      }
    }
    return true;
  }

  function normalCompletion(aliasRecords) {
    return {
      normal: aliasRecords,
      breaks: [],
      continues: [],
      returns: [],
      throws: [],
    };
  }

  function emptyCompletion() {
    return {
      normal: null,
      breaks: [],
      continues: [],
      returns: [],
      throws: [],
    };
  }

  function abruptCompletion(kind, aliasRecords, label = null) {
    const completion = emptyCompletion();
    completion[kind].push({
      state: cloneAliasRecords(aliasRecords),
      label,
    });
    return completion;
  }

  function appendCompletion(target, source) {
    for (const kind of ["breaks", "continues", "returns", "throws"]) {
      target[kind].push(...source[kind]);
    }
    return target;
  }

  function mergeNormalStates(states) {
    const presentStates = states.filter(Boolean);
    if (!presentStates.length) {
      return null;
    }
    return mergeAliasRecords(presentStates);
  }

  function mergeCompletions(completions) {
    const merged = emptyCompletion();
    merged.normal = mergeNormalStates(
      completions.map((completion) => completion.normal),
    );
    for (const completion of completions) {
      appendCompletion(merged, completion);
    }
    return merged;
  }

  function splitAbruptEntries(entries, shouldConsume) {
    const consumed = [];
    const retained = [];
    for (const entry of entries) {
      (shouldConsume(entry) ? consumed : retained).push(entry);
    }
    return { consumed, retained };
  }

  function abruptStates(entries) {
    return entries.map((entry) => entry.state);
  }

  function processStatementList(statements, aliasRecords) {
    const completion = normalCompletion(aliasRecords);
    for (const statement of statements || []) {
      if (!completion.normal) {
        break;
      }
      const childCompletion = processStatement(
        statement,
        completion.normal,
      );
      completion.normal = childCompletion.normal;
      appendCompletion(completion, childCompletion);
    }
    return completion;
  }

  function widenAliasRecords(aliasRecordMaps) {
    const records = new Set(resolution.targetRecords);
    for (const aliasRecords of aliasRecordMaps) {
      for (const record of aliasRecords.keys()) {
        records.add(record);
      }
    }
    return new Map(
      [...records].map((record) => [record, maybeTrackedState()]),
    );
  }

  function processVariableDeclaration(node, aliasRecords) {
    for (const declarator of node.declarations || []) {
      processPatternExpressions(declarator.id, aliasRecords);
      processExpression(declarator.init, aliasRecords, {
        suppressContainerEscape: declarator.id.type !== "Identifier",
        actionProofReachable:
          isFunctionNode(declarator.init)
            ? exportedFunctionNodes.has(declarator.init)
            : null,
      });
      processEvent(declarator, aliasRecords);
      transferPatternIdentity(
        declarator.id,
        declarator.init,
        aliasRecords,
        { preserveConfiguredTargets: true },
      );
      recordPotentialThrow(aliasRecords);
    }
    return aliasRecords;
  }

  function iterableElementTransfer(
    expression,
    aliasRecords,
    loopType,
  ) {
    if (loopType === "ForInStatement") {
      return {
        classification: { status: "none", reference: null },
        sourceExpressions: [],
      };
    }
    const node = unwrapChain(expression);
    if (node?.type === "ArrayExpression") {
      const sourceExpressions = (node.elements || []).filter(Boolean);
      const classifications = sourceExpressions.map((element) =>
        referenceClassification(element, aliasRecords)
      );
      return {
        classification: classifications.length
          ? mergeReferenceClassifications(classifications)
          : { status: "none", reference: null },
        sourceExpressions,
      };
    }
    const iterable = referenceClassification(node, aliasRecords);
    return {
      classification: iterable.status === "none"
        ? iterable
        : { status: "maybe", reference: null },
      sourceExpressions: [],
    };
  }

  function processLoopBinding(
    left,
    right,
    aliasRecords,
    loopNode,
  ) {
    const transfer = iterableElementTransfer(
      right,
      aliasRecords,
      loopNode.type,
    );
    if (left?.type === "VariableDeclaration") {
      for (const declarator of left.declarations || []) {
        transferPatternClassification(
          declarator.id,
          transfer.classification,
          transfer.sourceExpressions.length === 1
            ? transfer.sourceExpressions[0]
            : null,
          aliasRecords,
          {
            sourceExpressions: transfer.sourceExpressions,
          },
        );
      }
      recordPotentialThrow(aliasRecords);
      return;
    }
    processAssignmentTargetExpressions(left, aliasRecords);
    transferPatternClassification(
      left,
      transfer.classification,
      transfer.sourceExpressions.length === 1
        ? transfer.sourceExpressions[0]
        : null,
      aliasRecords,
      {
        sourceExpressions: transfer.sourceExpressions,
      },
    );
    processEvent(loopNode, aliasRecords);
    recordPotentialThrow(aliasRecords);
  }

  function processSwitchStatement(
    node,
    aliasRecords,
    { label = null } = {},
  ) {
    processExpression(node.discriminant, aliasRecords);
    const cases = node.cases || [];
    const stateAfterCaseTests = cloneAliasRecords(aliasRecords);
    const candidateStarts = [];
    let defaultIndex = -1;
    for (let index = 0; index < cases.length; index += 1) {
      const switchCase = cases[index];
      if (!switchCase.test) {
        defaultIndex = index;
        continue;
      }
      processExpression(switchCase.test, stateAfterCaseTests);
      candidateStarts.push({
        index,
        state: cloneAliasRecords(stateAfterCaseTests),
      });
    }
    if (defaultIndex >= 0) {
      candidateStarts.push({
        index: defaultIndex,
        state: cloneAliasRecords(stateAfterCaseTests),
      });
    }

    const branchCompletions = [];
    for (const candidate of candidateStarts) {
      let branch = normalCompletion(candidate.state);
      for (
        let caseIndex = candidate.index;
        caseIndex < cases.length && branch.normal;
        caseIndex += 1
      ) {
        const caseCompletion = processStatementList(
          cases[caseIndex].consequent,
          branch.normal,
        );
        branch.normal = caseCompletion.normal;
        appendCompletion(branch, caseCompletion);
      }
      branchCompletions.push(branch);
    }
    if (defaultIndex < 0 || !branchCompletions.length) {
      branchCompletions.push(
        normalCompletion(cloneAliasRecords(stateAfterCaseTests)),
      );
    }

    const completion = mergeCompletions(branchCompletions);
    const splitBreaks = splitAbruptEntries(
      completion.breaks,
      (entry) => loopConsumesLabel(entry, label),
    );
    completion.breaks = splitBreaks.retained;
    completion.normal = mergeNormalStates([
      completion.normal,
      ...abruptStates(splitBreaks.consumed),
    ]);
    return completion;
  }

  function applyFinally(completion, finalizer) {
    const result = emptyCompletion();
    const paths = [];
    if (completion.normal) {
      paths.push({ kind: "normal", entry: { state: completion.normal } });
    }
    for (const kind of ["breaks", "continues", "returns", "throws"]) {
      for (const entry of completion[kind]) {
        paths.push({ kind, entry });
      }
    }

    const normalStates = [];
    for (const path of paths) {
      const finalCompletion = processStatement(
        finalizer,
        cloneAliasRecords(path.entry.state),
      );
      if (finalCompletion.normal) {
        if (path.kind === "normal") {
          normalStates.push(finalCompletion.normal);
        } else {
          result[path.kind].push({
            state: finalCompletion.normal,
            label: path.entry.label ?? null,
          });
        }
      }
      appendCompletion(result, finalCompletion);
    }
    result.normal = mergeNormalStates(normalStates);
    return result;
  }

  function processTryStatement(statement, aliasRecords) {
    const entryState = cloneAliasRecords(aliasRecords);
    const collector = {
      owner: currentExecutionFunction(),
      states: [],
    };
    tryStateCollectors.push(collector);
    let tryCompletion;
    try {
      tryCompletion = processStatement(
        statement.block,
        cloneAliasRecords(aliasRecords),
      );
    } finally {
      tryStateCollectors.pop();
    }

    let completion = tryCompletion;
    if (statement.handler) {
      const thrownStates = [
        entryState,
        ...collector.states,
        ...abruptStates(tryCompletion.throws),
      ];
      const catchEntry = mergeAliasRecords(thrownStates);
      processPatternExpressions(statement.handler.param, catchEntry);
      const catchCompletion = processStatement(
        statement.handler.body,
        catchEntry,
      );
      completion = {
        normal: mergeNormalStates([
          tryCompletion.normal,
          catchCompletion.normal,
        ]),
        breaks: [
          ...tryCompletion.breaks,
          ...catchCompletion.breaks,
        ],
        continues: [
          ...tryCompletion.continues,
          ...catchCompletion.continues,
        ],
        returns: [
          ...tryCompletion.returns,
          ...catchCompletion.returns,
        ],
        throws: [...catchCompletion.throws],
      };
    } else if (collector.states.length) {
      completion = {
        ...tryCompletion,
        throws: [
          ...tryCompletion.throws,
          {
            state: entryState,
            label: null,
          },
          ...collector.states.map((state) => ({
            state,
            label: null,
          })),
        ],
      };
    }

    return statement.finalizer
      ? applyFinally(completion, statement.finalizer)
      : completion;
  }

  function loopConsumesLabel(entry, label) {
    const labels = Array.isArray(label) ? label : [label];
    return entry.label === null || labels.includes(entry.label);
  }

  function loopBackedgeStates(
    completion,
    label,
    applyBackedge,
  ) {
    const splitContinues = splitAbruptEntries(
      completion.continues,
      (entry) => loopConsumesLabel(entry, label),
    );
    completion.continues = splitContinues.retained;
    const states = [
      completion.normal,
      ...abruptStates(splitContinues.consumed),
    ].filter(Boolean);
    return states.map((state) => {
      const backedgeState = cloneAliasRecords(state);
      applyBackedge(backedgeState);
      return backedgeState;
    });
  }

  function stabilizeLoopHead({
    initialHead,
    analyzeIteration,
    applyBackedge,
  }) {
    let head = cloneAliasRecords(initialHead);
    let completion = emptyCompletion();
    let backedges = [];
    for (let iteration = 0; iteration < 8; iteration += 1) {
      completion = analyzeIteration(cloneAliasRecords(head));
      backedges = applyBackedge(completion);
      const nextHead = mergeNormalStates([initialHead, ...backedges])
        || cloneAliasRecords(initialHead);
      if (aliasRecordsEqual(head, nextHead)) {
        return { head, completion, backedges };
      }
      head = nextHead;
    }

    head = widenAliasRecords([initialHead, head, ...backedges]);
    completion = analyzeIteration(cloneAliasRecords(head));
    backedges = applyBackedge(completion);
    return { head, completion, backedges };
  }

  function finishLoopCompletion({
    completion,
    naturalExitStates,
    label,
  }) {
    const splitBreaks = splitAbruptEntries(
      completion.breaks,
      (entry) => loopConsumesLabel(entry, label),
    );
    completion.breaks = splitBreaks.retained;
    completion.normal = mergeNormalStates([
      ...naturalExitStates,
      ...abruptStates(splitBreaks.consumed),
    ]);
    return completion;
  }

  function processForStatement(
    statement,
    aliasRecords,
    { label = null } = {},
  ) {
    if (statement.init?.type === "VariableDeclaration") {
      processVariableDeclaration(statement.init, aliasRecords);
    } else {
      processExpression(statement.init, aliasRecords);
    }
    processExpression(statement.test, aliasRecords);
    const initialHead = cloneAliasRecords(aliasRecords);
    const stabilized = stabilizeLoopHead({
      initialHead,
      analyzeIteration: (head) => processStatement(statement.body, head),
      applyBackedge: (completion) => loopBackedgeStates(
        completion,
        label,
        (state) => {
          processExpression(statement.update, state);
          processExpression(statement.test, state);
        },
      ),
    });
    return finishLoopCompletion({
      completion: stabilized.completion,
      naturalExitStates: [stabilized.head],
      label,
    });
  }

  function processForInOfStatement(
    statement,
    aliasRecords,
    { label = null } = {},
  ) {
    processExpression(statement.right, aliasRecords, {
      suppressContainerEscape: true,
    });
    const initialHead = cloneAliasRecords(aliasRecords);
    const stabilized = stabilizeLoopHead({
      initialHead,
      analyzeIteration: (head) => {
        processLoopBinding(
          statement.left,
          statement.right,
          head,
          statement,
        );
        return processStatement(statement.body, head);
      },
      applyBackedge: (completion) => loopBackedgeStates(
        completion,
        label,
        () => {},
      ),
    });
    return finishLoopCompletion({
      completion: stabilized.completion,
      naturalExitStates: [initialHead, ...stabilized.backedges],
      label,
    });
  }

  function processWhileStatement(
    statement,
    aliasRecords,
    { label = null } = {},
  ) {
    processExpression(statement.test, aliasRecords);
    const initialHead = cloneAliasRecords(aliasRecords);
    const stabilized = stabilizeLoopHead({
      initialHead,
      analyzeIteration: (head) => processStatement(statement.body, head),
      applyBackedge: (completion) => loopBackedgeStates(
        completion,
        label,
        (state) => processExpression(statement.test, state),
      ),
    });
    return finishLoopCompletion({
      completion: stabilized.completion,
      naturalExitStates: [stabilized.head],
      label,
    });
  }

  function processDoWhileStatement(
    statement,
    aliasRecords,
    { label = null } = {},
  ) {
    const initialHead = cloneAliasRecords(aliasRecords);
    const stabilized = stabilizeLoopHead({
      initialHead,
      analyzeIteration: (head) => processStatement(statement.body, head),
      applyBackedge: (completion) => loopBackedgeStates(
        completion,
        label,
        (state) => processExpression(statement.test, state),
      ),
    });
    return finishLoopCompletion({
      completion: stabilized.completion,
      naturalExitStates: stabilized.backedges,
      label,
    });
  }

  function processLabeledStatement(statement, aliasRecords) {
    const labels = [];
    let body = statement;
    while (body?.type === "LabeledStatement") {
      labels.push(body.label?.name || null);
      body = body.body;
    }
    if (body.type === "ForStatement") {
      return processForStatement(body, aliasRecords, { label: labels });
    }
    if (body.type === "ForInStatement" || body.type === "ForOfStatement") {
      return processForInOfStatement(body, aliasRecords, { label: labels });
    }
    if (body.type === "WhileStatement") {
      return processWhileStatement(body, aliasRecords, { label: labels });
    }
    if (body.type === "DoWhileStatement") {
      return processDoWhileStatement(body, aliasRecords, { label: labels });
    }
    if (body.type === "SwitchStatement") {
      return processSwitchStatement(body, aliasRecords, { label: labels });
    }
    const completion = processStatement(body, aliasRecords);
    const splitBreaks = splitAbruptEntries(
      completion.breaks,
      (entry) => labels.includes(entry.label),
    );
    completion.breaks = splitBreaks.retained;
    completion.normal = mergeNormalStates([
      completion.normal,
      ...abruptStates(splitBreaks.consumed),
    ]);
    return completion;
  }

  function processStatement(statement, aliasRecords) {
    if (!statement) {
      return normalCompletion(aliasRecords);
    }
    if (statement.type === "Program" || statement.type === "BlockStatement") {
      return processStatementList(statement.body, aliasRecords);
    }
    if (isFunctionNode(statement)) {
      processFunction(statement, aliasRecords, {
        actionProofReachable:
          exportedFunctionNodes.has(statement),
      });
      return normalCompletion(aliasRecords);
    }
    if (statement.type === "VariableDeclaration") {
      return normalCompletion(
        processVariableDeclaration(statement, aliasRecords),
      );
    }
    if (statement.type === "ExpressionStatement") {
      return normalCompletion(
        processExpression(statement.expression, aliasRecords),
      );
    }
    if (statement.type === "IfStatement") {
      processExpression(statement.test, aliasRecords);
      if (
        statement.test?.type === "Literal"
        && typeof statement.test.value === "boolean"
      ) {
        return statement.test.value
          ? processStatement(
            statement.consequent,
            cloneAliasRecords(aliasRecords),
          )
          : statement.alternate
            ? processStatement(
              statement.alternate,
              cloneAliasRecords(aliasRecords),
            )
            : normalCompletion(cloneAliasRecords(aliasRecords));
      }
      const consequentCompletion = processStatement(
        statement.consequent,
        cloneAliasRecords(aliasRecords),
      );
      const alternateCompletion = statement.alternate
        ? processStatement(
          statement.alternate,
          cloneAliasRecords(aliasRecords),
        )
        : normalCompletion(cloneAliasRecords(aliasRecords));
      return mergeCompletions([
        consequentCompletion,
        alternateCompletion,
      ]);
    }
    if (statement.type === "SwitchStatement") {
      return processSwitchStatement(statement, aliasRecords);
    }
    if (statement.type === "TryStatement") {
      return processTryStatement(statement, aliasRecords);
    }
    if (statement.type === "ForStatement") {
      return processForStatement(statement, aliasRecords);
    }
    if (
      statement.type === "ForInStatement"
      || statement.type === "ForOfStatement"
    ) {
      return processForInOfStatement(statement, aliasRecords);
    }
    if (statement.type === "WhileStatement") {
      return processWhileStatement(statement, aliasRecords);
    }
    if (statement.type === "DoWhileStatement") {
      return processDoWhileStatement(statement, aliasRecords);
    }
    if (statement.type === "BreakStatement") {
      return abruptCompletion(
        "breaks",
        aliasRecords,
        statement.label?.name || null,
      );
    }
    if (statement.type === "ContinueStatement") {
      return abruptCompletion(
        "continues",
        aliasRecords,
        statement.label?.name || null,
      );
    }
    if (statement.type === "ReturnStatement") {
      processExpression(statement.argument, aliasRecords);
      if (!borrowedProjectionCallsWithReportedBorrowedArgument.has(
        unwrapChain(statement.argument),
      )) {
        recordClassificationDiagnostic(
          referenceClassification(statement.argument, aliasRecords),
          statement.argument || statement,
          "state-alias-escape",
          { evidenceKind: "return-value" },
        );
      }
      return abruptCompletion("returns", aliasRecords);
    }
    if (statement.type === "ThrowStatement") {
      processExpression(statement.argument, aliasRecords);
      return abruptCompletion("throws", aliasRecords);
    }
    if (statement.type === "LabeledStatement") {
      return processLabeledStatement(statement, aliasRecords);
    }
    if (statement.type === "WithStatement") {
      processExpression(statement.object, aliasRecords);
      return processStatement(statement.body, aliasRecords);
    }
    if (statement.type === "ExportNamedDeclaration") {
      if (statement.declaration) {
        return processStatement(statement.declaration, aliasRecords);
      }
      for (const specifier of statement.specifiers || []) {
        recordExpressionAliasEscape(specifier.local, aliasRecords);
      }
      return normalCompletion(aliasRecords);
    }
    if (statement.type === "ExportDefaultDeclaration") {
      const declaration = statement.declaration;
      if (!declaration) {
        return normalCompletion(aliasRecords);
      }
      if (
        declaration.type.endsWith("Declaration")
        || isFunctionNode(declaration)
      ) {
        return processStatement(declaration, aliasRecords);
      }
      const nextAliasRecords = processExpression(
        declaration,
        aliasRecords,
      );
      recordExpressionAliasEscape(declaration, nextAliasRecords);
      return normalCompletion(nextAliasRecords);
    }

    const completion = normalCompletion(aliasRecords);
    for (const child of childNodes(statement)) {
      if (!completion.normal) {
        break;
      }
      const childCompletion = (
        child.node.type.endsWith("Statement")
        || child.node.type === "VariableDeclaration"
      )
        ? processStatement(child.node, completion.normal)
        : normalCompletion(
          processExpression(child.node, completion.normal),
        );
      completion.normal = childCompletion.normal;
      appendCompletion(completion, childCompletion);
    }
    return completion;
  }

  const scopedFunctionParameterOwner = (() => {
    if (
      analysisTraversalMode !== "auto"
      || binding.kind !== "function-parameter"
    ) {
      return null;
    }
    const targetRecords = [...(resolution.targetRecords || [])];
    if (targetRecords.length !== 1) {
      return null;
    }
    const [targetRecord] = targetRecords;
    return isFunctionNode(targetRecord?.ownerNode)
      ? targetRecord.ownerNode
      : null;
  })();
  if (scopedFunctionParameterOwner) {
    processFunction(scopedFunctionParameterOwner, new Map(), {
      actionProofReachable:
        exportedFunctionNodes.has(scopedFunctionParameterOwner),
    });
  } else {
    processStatement(analysis.ast, new Map());
  }

  function prepareSourceBoundMutationDelegatingOwnerActionEdges() {
    if (
      typeof analysisInstrumentation
        ?.onPrepareSourceBoundMutationDelegatingOwnerProof === "function"
    ) {
      analysisInstrumentation.onPrepareSourceBoundMutationDelegatingOwnerProof();
    }
    const candidates = [];
    for (const contract of mutationDelegatingOwnerContractsForCurrentModule()) {
      let compositionFunction = null;
      walk.full(analysis.ast, (node) => {
        if (
          !compositionFunction
          && isFunctionNode(node)
          && hasExactMutationDelegatingOwnerCompositionFunction(contract, node)
        ) compositionFunction = node;
      });
      if (!compositionFunction) continue;

      const factoryCalls = [];
      walk.full(compositionFunction.body, (node) => {
        if (
          node?.type === "CallExpression"
          && mutationDelegatingOwnerFactoryContractForCall(node) === contract
        ) factoryCalls.push(node);
      });
      if (factoryCalls.length !== 1) continue;

      let hasRegisteredFacadeMethod = false;
      walk.full(analysis.ast, (node) => {
        if (hasRegisteredFacadeMethod || node?.type !== "CallExpression") return;
        const member = unwrapChain(node.callee);
        if (member?.type !== "MemberExpression") return;
        const ownerGetterCall = unwrapChain(member.object);
        const methodName = staticPropertyName(member.property, member.computed);
        if (
          contract.methods.includes(methodName)
          && directImmutableLocalHelperNode(ownerGetterCall)
            === compositionFunction
        ) hasRegisteredFacadeMethod = true;
      });
      if (!hasRegisteredFacadeMethod) continue;

      const [factoryCall] = factoryCalls;
      walk.full(compositionFunction.body, (node) => {
        if (node?.type !== "CallExpression") return;
        const actionContract = importedTargetDelegation(node)?.actionContract;
        if (!actionContract) return;
        const actionModulePath =
          contract.actionModulePathsByExport?.[actionContract.exportName]
          || contract.actionModulePath;
        if (
          !contract.actionExports.includes(actionContract.exportName)
          || actionModulePath !== actionContract.modulePath
          || node.start < factoryCall.start
          || node.end > factoryCall.end
        ) return;
        const target = unwrapChain(
          node.arguments?.[actionContract.targetArgumentIndex],
        );
        if (target?.type !== "Identifier") return;
        let enclosingFunction = analysis.parentNodeForNode(node);
        while (enclosingFunction && !isFunctionNode(enclosingFunction)) {
          enclosingFunction = analysis.parentNodeForNode(enclosingFunction);
        }
        candidates.push({
          actionContract,
          node,
          targetName: target.name,
          targetRecord: analysis.resolveIdentifier(target),
          enclosingFunctionIdentity:
            functionIdentityContext.identityForFunctionNode(enclosingFunction),
        });
      });
    }
    if (
      typeof analysisInstrumentation
        ?.onCompleteSourceBoundMutationDelegatingOwnerProofPreparation
        === "function"
    ) {
      analysisInstrumentation
        .onCompleteSourceBoundMutationDelegatingOwnerProofPreparation({
          candidateCount: candidates.length,
        });
    }
    return candidates;
  }

  function collectSourceBoundMutationDelegatingOwnerActionEdges() {
    const edges = [];
    const suppressedRanges = new Set();
    const targetRecords = resolution.targetRecords || new Set();
    if (
      typeof analysisInstrumentation
        ?.onApplySourceBoundMutationDelegatingOwnerProof === "function"
    ) {
      analysisInstrumentation.onApplySourceBoundMutationDelegatingOwnerProof({
        bindingId: binding.id,
      });
    }
    const candidates = getSourceBoundOwnerProofPreparationForScan(
      prepareSourceBoundMutationDelegatingOwnerActionEdges,
    );
    for (const {
      actionContract,
      node,
      targetName,
      targetRecord,
      enclosingFunctionIdentity,
    } of candidates) {
      if (
        !targetRecords.has(targetRecord)
        && targetName !== resolution.virtualModuleName
      ) continue;
      suppressedRanges.add(`${node.start}:${node.end}`);
      edges.push(createActionDelegationEdge(
        source,
        filePath,
        binding,
        actionContract,
        node,
        enclosingFunctionIdentity,
      ));
    }
    return { edges, suppressedRanges };
  }

  const sourceBoundOwnerProof =
    collectSourceBoundMutationDelegatingOwnerActionEdges();
  const retainedActionDelegations = actionDelegations.filter(
    ({ start, end }) =>
      !sourceBoundOwnerProof.suppressedRanges.has(`${start}:${end}`),
  );
  actionDelegations.length = 0;
  actionDelegations.push(
    ...retainedActionDelegations,
    ...sourceBoundOwnerProof.edges,
  );

  return {
    findings: functionIdentityContext.decorateSortedFindings(
      [...findings, ...diagnostics]
        .sort(
          (left, right) =>
            left.start - right.start || left.end - right.end,
        ),
    )
      .filter(
        (finding, index, allFindings) =>
          index === 0
          || finding.start !== allFindings[index - 1].start
          || finding.operation !== allFindings[index - 1].operation
          || finding.key !== allFindings[index - 1].key
          || finding.bindingId !== allFindings[index - 1].bindingId
          || finding.reason !== allFindings[index - 1].reason,
      ),
    actionDelegations,
  };
}

export function discoverFunctionParameterBindings(
  source = "",
  { parameterNames = DEFAULT_PARAMETER_NAMES } = {},
) {
  const normalizedSource = normalizeJavaScriptSource(source);
  const { parsed, analysis } = parseAndAnalyzeJavaScript(normalizedSource);
  if (!parsed.ast) {
    return {
      bindings: [],
      diagnostics: [parsed.diagnostic],
    };
  }
  const candidateNames = parameterNames === null
    ? null
    : new Set(parameterNames.map(String));
  const bindings = [];
  for (const functionRecord of analysis.functionRecords) {
    const locator = functionLocator(functionRecord);
    for (const parameterRecord of functionRecord.parameterRecords) {
      if (candidateNames && !candidateNames.has(parameterRecord.name)) {
        continue;
      }
      bindings.push({
        functionName: functionRecord.name,
        parameterName: parameterRecord.name,
        parameterIndex: Number(parameterRecord.parameterIndex || 0),
        parameterPath: parameterRecord.parameterPath || "$",
        line: locator.line,
        column: locator.column,
      });
    }
  }
  return {
    bindings: bindings.sort(
      (left, right) =>
        left.line - right.line
        || left.column - right.column
        || left.functionName.localeCompare(right.functionName)
        || left.parameterIndex - right.parameterIndex
        || left.parameterName.localeCompare(right.parameterName)
        || left.parameterPath.localeCompare(right.parameterPath),
    ),
    diagnostics: [],
  };
}

export function scanStateMutationInventory(
  source = "",
  {
    bindings = [],
    filePath = "",
    derivedAliasTaintMode =
      DERIVED_ALIAS_TAINT_MODES.STRICT,
    analysisTraversalMode = "auto",
    analysisInstrumentation = null,
    recognizeCurrentContracts = true,
  } = {},
) {
  const normalizedSource = normalizeJavaScriptSource(source);
  const normalizedDerivedAliasTaintMode =
    normalizeDerivedAliasTaintMode(derivedAliasTaintMode);
  const normalizedBindings = normalizeBindings(bindings);
  const { parsed, analysis } = parseAndAnalyzeJavaScript(normalizedSource);
  if (!parsed.ast) {
    return {
      findings: [
        createUnsupportedFinding(
          filePath,
          normalizedBindings[0],
          parsed.diagnostic,
        ),
      ],
      actionDelegations: [],
    };
  }
  let bindingMutationAnalysisContext = null;
  let sourceBoundOwnerProofPreparation = null;
  const getBindingMutationAnalysisContextForScan = () => {
    if (
      analysisInstrumentation?.bindingMutationAnalysisContextMode
        === "fresh"
    ) {
      return getBindingMutationAnalysisContext(
        analysis,
        analysisInstrumentation,
      );
    }
    if (!bindingMutationAnalysisContext) {
      bindingMutationAnalysisContext = getBindingMutationAnalysisContext(
        analysis,
        analysisInstrumentation,
      );
    }
    return bindingMutationAnalysisContext;
  };
  const getSourceBoundOwnerProofPreparationForScan = (prepare) => {
    if (
      analysisInstrumentation?.sourceBoundOwnerProofPreparationMode
        === "fresh"
    ) {
      return prepare();
    }
    if (!sourceBoundOwnerProofPreparation) {
      sourceBoundOwnerProofPreparation = prepare();
    }
    return sourceBoundOwnerProofPreparation;
  };
  const inventories = normalizedBindings.map((binding) => {
      const resolution = resolveConfiguredBinding(analysis, binding);
      return analyzeBindingMutations(
        analysis,
        binding,
        resolution,
        {
          filePath,
          source: normalizedSource,
          derivedAliasTaintMode:
            normalizedDerivedAliasTaintMode,
          analysisTraversalMode,
          analysisInstrumentation,
          recognizeCurrentContracts,
          getBindingMutationAnalysisContextForScan,
          getSourceBoundOwnerProofPreparationForScan,
        },
      );
    });
  const findings = inventories
    .flatMap((inventory) => inventory.findings)
    .sort(
      (left, right) =>
        left.start - right.start
        || left.end - right.end
        || left.bindingId.localeCompare(right.bindingId),
    );
  const actionDelegations = inventories
    .flatMap((inventory) => inventory.actionDelegations)
    .sort(
      (left, right) =>
        left.start - right.start
        || left.end - right.end
        || left.bindingId.localeCompare(right.bindingId)
        || left.actionModulePath.localeCompare(right.actionModulePath)
        || left.actionExportName.localeCompare(right.actionExportName)
        || left.targetArgumentIndex - right.targetArgumentIndex,
    )
    .filter(
      (edge, index, edges) =>
        index === 0
        || edge.start !== edges[index - 1].start
        || edge.end !== edges[index - 1].end
        || edge.bindingId !== edges[index - 1].bindingId
        || edge.actionModulePath !== edges[index - 1].actionModulePath
        || edge.actionExportName !== edges[index - 1].actionExportName
        || edge.targetArgumentIndex !== edges[index - 1].targetArgumentIndex,
    );
  return {
    findings,
    actionDelegations,
  };
}

export function scanStateMutations(source = "", options = {}) {
  return scanStateMutationInventory(source, options).findings;
}
