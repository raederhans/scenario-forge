import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "acorn";
import {
  STATE_COUNTRY_INSPECTOR_PROJECTION_MODULE_PATH as MODULE_PATH,
  inspectStateCountryInspectorProjectionSources,
  resolveStateCountryInspectorProjectionCall,
} from "../tools/state_country_inspector_projection_contract.mjs";
import { scanStateMutations } from "../tools/state_writer_inventory.mjs";
import { discoverStateWriterBindingsForSource } from "../tools/build_state_writer_policy.mjs";
import { createCountryInspectorModel } from "../js/ui/sidebar/country_inspector_model.js";
import { normalizeCountryCodeAlias } from "../js/core/country_code_aliases.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n?/g, "\n");
const hash = value => createHash("sha256").update(value).digest("hex");
const source = read(MODULE_PATH);
const ALIASES_PATH = "js/core/country_code_aliases.js";
const binding = { id: "country-projection-probe", kind: "function-parameter", name: "runtimeState",
  functionName: "createCountryInspectorModel", parameterName: "runtimeState", parameterIndex: 0, parameterPath: "$" };
const createModel = state => createCountryInspectorModel(state, value => value);

function nodesOf(value) {
  const nodes = [], seen = new Set();
  function visit(node) {
    if (!node || typeof node !== "object" || !node.type || seen.has(node)) return;
    seen.add(node); nodes.push(node);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child?.type) visit(child);
    }
  }
  visit(value);
  return nodes;
}
const parseNodes = text => nodesOf(parse(text, { ecmaVersion: "latest", sourceType: "module", locations: true }));
const factory = parseNodes(source).find(node => node.type === "FunctionDeclaration" && node.id?.name === binding.functionName);
const factorySource = source.slice(factory.start, factory.end);
const views = [["module", source], ["factory-slice", factorySource]];
const inspect = (text = source, readSource = read) => inspectStateCountryInspectorProjectionSources({ source: text, readSource });
const resolve = (receipt, call, helper, text = source, filePath = MODULE_PATH) =>
  resolveStateCountryInspectorProjectionCall(receipt, call, helper, { source: text, filePath });
const scan = (text = source, options = {}) => scanStateMutations(text, { filePath: MODULE_PATH, bindings: [binding], ...options });
const replace = (text, before, after) => {
  assert.ok(text.includes(before), `fixture anchor exists: ${before}`);
  return text.replace(before, after);
};
function resolvedNodes(receipt, text) {
  const nodes = parseNodes(text);
  return Object.values(receipt.operationsByKey).map(operation => ({ operation,
    call: nodes.find(node => node.type === "CallExpression" && node.start === operation.expression.start && node.end === operation.expression.end),
    helper: nodes.find(node => node.type === "FunctionDeclaration" && node.start === operation.helper.start && node.end === operation.helper.end),
  }));
}

for (const [view, text] of views) {
  test(`country projection issues frozen exact lexical call/result receipts for the ${view}`, () => {
    for (const actual of [text, text.replaceAll("\n", "\r\n")]) {
      const { violations, receipt } = inspect(actual);
      assert.deepEqual(violations, []);
      assert.equal(receipt.sourceView, view);
      assert.equal(receipt.sourceFingerprint, hash(text));
      assert.equal(receipt.moduleSourceFingerprint, hash(source));
      assert.equal(receipt.dependencyFingerprints[ALIASES_PATH], hash(read(ALIASES_PATH)));
      assert.deepEqual(receipt.unhandledBorrowedReturns, ["getScenarioCountryMeta", "getCountryGroupingMeta"]);
      assert.match(receipt.effectBoundary, /getters, Proxy traps and nested effects remain analyzed/);
      const counts = {};
      for (const { operation, call, helper } of resolvedNodes(receipt, text)) {
        counts[operation.helperName] = (counts[operation.helperName] || 0) + 1;
        assert.equal(resolve(receipt, call, helper, actual), operation);
        assert.equal(operation.expression.source, text.slice(call.start, call.end));
        assert.equal(operation.expression.sourceFingerprint, hash(operation.expression.source));
        assert.equal(operation.helper.sourceFingerprint, hash(text.slice(helper.start, helper.end)));
        assert.equal(operation.helperLexicalIdentity, receipt.helpers[operation.helperName].lexicalIdentity);
        assert.ok(operation.expression.lexicalFunctionIdentities.some(identity => identity.includes("#createCountryInspectorModel@")));
        assert.deepEqual(operation.borrowedArgumentIndexes, call.arguments.map((_, index) => index));
        assert.deepEqual(operation.result.borrowedResultPaths, []);
        assert.equal(operation.effectsPreserved, true);
        assert.equal(operation.effects.argumentEvaluationRequired, true);
        assert.equal(operation.effects.nestedEffectsRequired, true);
        assert.equal(operation.effects.directParameterWrites, false);
        assert.equal(operation.effects.parameterPublication, false);
        for (const argument of operation.arguments) assert.equal(argument.sourceFingerprint, hash(argument.source));
      }
      assert.deepEqual(counts, { primitiveText: 6, normalizeCountryCode: 35, readExplicitInspectorGroupMeta: 2, collectScenarioInspectorIso2Codes: 1 });
      for (const name of ["primitiveText", "normalizeCountryCode"]) {
        assert.deepEqual(receipt.helpers[name].result, { kind: "scalar", type: "string", borrowedResultPaths: [] });
      }
      assert.deepEqual(receipt.helpers.readExplicitInspectorGroupMeta.result.fields, { id: "string", label: "string", anchorId: "string" });
      assert.equal(receipt.helpers.readExplicitInspectorGroupMeta.result.allocation, "per-invocation");
      assert.equal(receipt.helpers.collectScenarioInspectorIso2Codes.result.elementType, "string");
      assert.equal(receipt.helpers.collectScenarioInspectorIso2Codes.result.allocation, "per-invocation");
      assert.ok(Object.isFrozen(receipt) && Object.isFrozen(receipt.operationsByKey));
      assert.throws(() => { receipt.helpers.normalizeCountryCode.result.type = "object"; }, TypeError);
      assert.throws(() => { Object.values(receipt.operationsByKey)[0].borrowedArgumentIndexes.push(9); }, TypeError);
    }
  });
}

test("country projection requires its issued receipt and the actual matching source view", () => {
  const { receipt } = inspect(), { call, helper } = resolvedNodes(receipt, source)[0];
  for (const forged of [null, {}, { ...receipt }, structuredClone(receipt)]) assert.equal(resolve(forged, call, helper), null);
  assert.equal(resolve(receipt, call, helper, source, "js/unrelated.js"), null);
  assert.equal(resolve(receipt, call, helper, `${source}\n`), null);
  assert.equal(resolve(receipt, call, helper, factorySource), null);
  assert.equal(resolveStateCountryInspectorProjectionCall(receipt, call, helper, { filePath: MODULE_PATH }), null);
  assert.equal(resolve(receipt, { ...call, start: call.start + 1 }, helper), null);
  assert.equal(resolve(receipt, call, { ...helper, start: helper.start + 1 }), null);
  const sliceReceipt = inspect(factorySource).receipt;
  const sliceNodes = resolvedNodes(sliceReceipt, factorySource)[0];
  assert.equal(resolve(receipt, sliceNodes.call, sliceNodes.helper), null);
  assert.equal(resolve(sliceReceipt, call, helper, factorySource), null);
});

const forgedAstMutations = {
  "callee": (call) => { call.callee.name = "publish"; },
  "argument": (call) => { call.arguments[0] = { type: "Identifier", name: "runtimeState" }; },
  "spread argument": (call) => { call.arguments[0] = { type: "SpreadElement", argument: call.arguments[0] }; },
  "optional call": (call) => { call.optional = true; },
  "helper binding": (_call, helper) => { helper.id.name = "shadow"; },
  "helper body": (_call, helper) => { helper.body.body.push({ type: "ReturnStatement", argument: { type: "Identifier", name: "runtimeState" } }); },
  "helper parameter": (_call, helper) => { helper.params[0].name = "shadow"; },
};
for (const [name, mutate] of Object.entries(forgedAstMutations)) {
  test(`country projection rejects same-offset forged ${name} AST`, () => {
    const { receipt } = inspect(), nodes = resolvedNodes(receipt, source)[0];
    const call = structuredClone(nodes.call), helper = structuredClone(nodes.helper);
    mutate(call, helper);
    assert.equal(resolve(receipt, call, helper), null);
  });
}

test("country projection grants no metadata reader return or other local helper", () => {
  const { receipt } = inspect(), nodes = parseNodes(source);
  for (const name of receipt.unhandledBorrowedReturns) {
    const helper = nodes.find(node => node.type === "FunctionDeclaration" && node.id?.name === name);
    for (const call of nodes.filter(node => node.type === "CallExpression" && node.callee?.name === name)) {
      assert.equal(resolve(receipt, call, helper), null);
    }
    assert.equal(receipt.helpers[name], undefined);
  }
  const first = resolvedNodes(receipt, source)[0];
  const shadow = parseNodes("function primitiveText(value) { return value; }").find(node => node.type === "FunctionDeclaration");
  assert.equal(resolve(receipt, first.call, shadow), null);
});

const sourceDrifts = {
  "object/function coercion before the guard": ['if (typeof value === "object" || typeof value === "function") return "";', 'String(value); if (typeof value === "object" || typeof value === "function") return "";'],
  "guard removal": ['if (typeof value === "object" || typeof value === "function") return "";', ""],
  "borrowed scalar return": ['return String(value || "");', "return value;"],
  "parameter publication": ['return String(value || "");', 'publish(value); return String(value || "");'],
  "new helper state write": ["function primitiveText(value) {", "function primitiveText(value) { runtimeState.width = 7;"],
  "inherited alias read": ["Object.hasOwn(COUNTRY_CODE_ALIASES, code) ? COUNTRY_CODE_ALIASES[code] : code", "COUNTRY_CODE_ALIASES[code] || code"],
  "helper shadow": ["const scenarioMeta = getScenarioCountryMeta(entryOrCode);", 'const normalizeCountryCode = value => value; const scenarioMeta = getScenarioCountryMeta(entryOrCode);'],
  "helper reassignment": ["const scenarioMeta = getScenarioCountryMeta(entryOrCode);", "normalizeCountryCode = value => value; const scenarioMeta = getScenarioCountryMeta(entryOrCode);"],
  "group input returned": ["function readExplicitInspectorGroupMeta(entry = {}) {", "function readExplicitInspectorGroupMeta(entry = {}) { return entry;"],
  "group field left borrowed": ['const id = primitiveText(entry?.inspector_group_id || entry?.inspectorGroupId || "").trim();', "const id = entry.inspector_group_id;"],
  "Set stores a borrowed value": ["iso2Codes.add(normalized)", "iso2Codes.add(value)"],
  "Set aliases shared storage": ["const iso2Codes = new Set();", "const iso2Codes = runtimeState.sharedCodes;"],
  "Set returns borrowed entries": ["return iso2Codes;", "return entries;"],
  "nested callback mutates metadata": ['if (!entry || typeof entry !== "object") return;', 'if (!entry || typeof entry !== "object") return; entry.changed = true;'],
  "caller mutates metadata": ["const scenarioMeta = getScenarioCountryMeta(entryOrCode);", "const scenarioMeta = getScenarioCountryMeta(entryOrCode); scenarioMeta.changed = true;"],
  "new root write": ["function primitiveText(value) {", "runtimeState.width = 7; function primitiveText(value) {"],
  "nested argument state write": ["normalizeCountryCode(scenarioMeta?.preset_lookup_code)", "normalizeCountryCode((runtimeState.width = 7, scenarioMeta?.preset_lookup_code))"],
  "borrowed candidate array": ["normalizeCountryCode(scenarioMeta?.preset_lookup_code)", "scenarioMeta?.preset_lookup_code"],
  "extra call site": ["const scenarioMeta = getScenarioCountryMeta(entryOrCode);", "const scenarioMeta = getScenarioCountryMeta(entryOrCode); normalizeCountryCode(scenarioMeta);"],
  "import provider": ["../../core/country_code_aliases.js", "../../core/other_aliases.js"],
};
for (const [name, [before, after]] of Object.entries(sourceDrifts)) {
  test(`country projection source pin rejects ${name}`, () => {
    const changed = replace(source, before, after), result = inspect(changed);
    assert.equal(result.receipt, null);
    assert.ok(result.violations.length);
    assert.equal(inspect(changed, path => path === MODULE_PATH ? changed : read(path)).receipt, null);
  });
}

test("country projection refuses alias dependency drift, missing evidence and arbitrary source slices", () => {
  for (const [before, after] of [['UK: "GB"', 'UK: "XX"'], ["Object.freeze({", "Object.assign({"], ["const COUNTRY_CODE_ALIASES", "let COUNTRY_CODE_ALIASES"]]) {
    const aliases = replace(read(ALIASES_PATH), before, after);
    const result = inspect(source, path => path === ALIASES_PATH ? aliases : read(path));
    assert.equal(result.receipt, null);
    assert.ok(result.violations.some(item => item.modulePath === ALIASES_PATH));
  }
  const changedModule = `${source}\n// unreviewed module consumer`;
  assert.equal(inspect(factorySource, path => path === MODULE_PATH ? changedModule : read(path)).receipt, null);
  for (const text of [`\n${factorySource}`, source.slice(factory.start - 7, factory.end), factorySource.slice(1)]) assert.equal(inspect(text).receipt, null);
  assert.equal(inspect(source, () => { throw Error("unavailable dependency"); }).receipt, null);
  assert.equal(inspectStateCountryInspectorProjectionSources().receipt, null);
});

test("country production discovery and both raw scan views retain exactly the original metadata diagnostics", async () => {
  for (const [, text] of views) {
    const findings = scan(text);
    assert.deepEqual(findings.map(({ key, reason, evidenceKind }) => [key, reason, evidenceKind]), [
      ["scenarioCountriesByTag", "state-alias-escape", "return-value"],
      ["countryGroupMetaByCode", "state-alias-escape", "unknown-call-argument"],
    ]);
    assert.ok(scan(text, { recognizeCurrentContracts: false }).length > findings.length);
    assert.ok(scan(text, { filePath: "js/unrelated.js" }).length > findings.length);
  }
  const discovery = await discoverStateWriterBindingsForSource(MODULE_PATH, source, "production", { includeInventories: true });
  assert.deepEqual(discovery.bindings, []);
  assert.deepEqual(discovery.bindingInventories, []);
});

test("country scanner still reports real root, helper and nested-argument writes at their actual source sites", () => {
  for (const [before, after] of [
    ["function primitiveText(value) {", "runtimeState.width = 7; function primitiveText(value) {"],
    ["const code = primitiveText(value).trim()", "runtimeState.width = 7; const code = primitiveText(value).trim()"],
    ["normalizeCountryCode(scenarioMeta?.preset_lookup_code)", "normalizeCountryCode((runtimeState.width = 7, scenarioMeta?.preset_lookup_code))"],
  ]) {
    const changed = replace(source, before, after), writeStart = changed.indexOf("runtimeState.width = 7");
    assert.equal(inspect(changed).receipt, null);
    assert.ok(scan(changed).some(finding => finding.operation === "assign" && finding.key === "width" && finding.start === writeStart));
  }
});

test("country scanner retains actual caller metadata mutation blockers without claiming detached return values", () => {
  const changed = replace(source, "const scenarioMeta = getScenarioCountryMeta(entryOrCode);",
    "const scenarioMeta = getScenarioCountryMeta(entryOrCode); scenarioMeta.changed = true;");
  const start = changed.indexOf("scenarioMeta.changed = true");
  assert.equal(inspect(changed).receipt, null);
  assert.ok(scan(changed).some(finding => finding.start === start && finding.unsupported && finding.reason === "ambiguous-alias-flow"));
  const mapMutation = replace(source, "return Map.prototype.get.call(runtimeState.countryGroupMetaByCode, normalizedCode) || null;",
    "const groupingMeta = Map.prototype.get.call(runtimeState.countryGroupMetaByCode, normalizedCode) || null; groupingMeta.changed = true; return groupingMeta;");
  assert.equal(inspect(mapMutation).receipt, null);
  // The existing scanner conservatively blocks the Map input escape; it does not
  // locate this returned Map value's write. Receipt refusal is a separate check.
  assert.ok(scan(mapMutation).some(finding => finding.key === "countryGroupMetaByCode" && finding.reason === "state-alias-escape"));
});

test("country primitive projection preserves normal lookup values and candidate priority", () => {
  const primitiveValues = [undefined, null, false, true, 0, 1, -3, NaN, Infinity, 0n, 12n, "", " ", "uk", " EL ", " f-r ", "CN", "__proto__", Symbol("uk")];
  for (const value of primitiveValues) {
    const expected = normalizeCountryCodeAlias(value), model = createModel({});
    assert.equal(model.resolveScenarioLookupCode(value), expected);
    assert.equal(model.resolveInspectorDataCode(value), expected);
  }
  for (const [method, snake, camel] of [["resolveScenarioLookupCode", "preset_lookup_code", "presetLookupCode"],
    ["resolveInspectorDataCode", "release_lookup_iso2", "releaseLookupIso2"]]) {
    const fields = [snake, camel, "lookup_iso2", "lookupIso2", "base_iso2", "baseIso2"];
    const meta = {}, entry = { code: "TAG" }, state = { activeScenarioId: "example", scenarioCountriesByTag: { TAG: meta } };
    const model = createModel(state), slots = fields.flatMap(field => [[meta, field], [entry, field]]);
    // Production precedence groups each snake/camel pair by scenario then entry.
    const ordered = [];
    for (let index = 0; index < fields.length; index += 2) for (const owner of [meta, entry]) for (const field of fields.slice(index, index + 2)) ordered.push([owner, field]);
    slots.forEach(([owner, field], index) => { owner[field] = `C${index}`; });
    for (const [owner, field] of ordered) {
      assert.equal(model[method](entry), owner[field]);
      owner[field] = "";
    }
    assert.equal(model[method](entry), "TAG");
  }
});

for (const hookType of ["object", "function"]) {
  test(`country code, group text and ISO projection reject ${hookType} coercion hooks`, () => {
    let calls = 0;
    const hook = () => { calls++; throw Error("unexpected object coercion"); };
    const malformed = hookType === "object" ? { toString: hook, valueOf: hook, [Symbol.toPrimitive]: hook } : Object.assign(function malformed() {}, { toString: hook, valueOf: hook, [Symbol.toPrimitive]: hook });
    const meta = { preset_lookup_code: malformed, release_lookup_iso2: malformed,
      inspector_group_id: malformed, inspector_group_label: malformed, inspector_group_anchor_id: malformed, base_iso2: malformed };
    const state = { activeScenarioId: "tno_1962", scenarioCountriesByTag: { TAG: meta } }, model = createModel(state);
    assert.equal(model.resolveScenarioLookupCode({ code: malformed }), "");
    assert.equal(model.resolveInspectorDataCode({ code: malformed }), "");
    assert.equal(model.resolveScenarioLookupCode("TAG"), "TAG");
    assert.equal(model.resolveInspectorDataCode("TAG"), "TAG");
    assert.deepEqual(model.resolveScenarioInspectorGroupMeta("TAG"), { id: "", label: "", anchorId: "" });
    state.activeScenarioId = malformed;
    assert.deepEqual(model.resolveScenarioInspectorGroupMeta("TAG"), { id: "", label: "", anchorId: "" });
    assert.equal(calls, 0);
  });
}

test("country alias projection does not dispatch inherited alias-table getters", () => {
  const property = "COUNTRYPROJECTIONINHERITEDPROBE";
  assert.equal(Object.hasOwn(Object.prototype, property), false);
  let calls = 0;
  Object.defineProperty(Object.prototype, property, { configurable: true, get() { calls++; return "HOOK"; } });
  try {
    assert.equal(normalizeCountryCodeAlias(property), "HOOK");
    assert.equal(calls, 1);
    assert.equal(createModel({}).resolveScenarioLookupCode(property), property);
    assert.equal(createModel({}).resolveInspectorDataCode(property), property);
    assert.equal(calls, 1);
  } finally { delete Object.prototype[property]; }
});

test("country group projection preserves string punctuation and ISO rules while property hooks remain observable", () => {
  const seen = [], raw = { inspector_group_id: "  group-id_中文  ", inspector_group_label: "  Label / 中文  ", inspector_group_anchor_id: " continent_asia " };
  const meta = new Proxy(raw, { get(target, property, receiver) { seen.push(property); return Reflect.get(target, property, receiver); } });
  const state = { activeScenarioId: "tno_1962", scenarioCountriesByTag: { TAG: meta } }, model = createModel(state);
  const group = model.resolveScenarioInspectorGroupMeta("TAG");
  assert.deepEqual(group, { id: "group-id_中文", label: "Label / 中文", anchorId: "continent_asia" });
  assert.notEqual(group, raw);
  assert.ok(seen.includes("inspector_group_id") && seen.includes("inspector_group_label"));
  group.id = "local";
  assert.equal(raw.inspector_group_id, "  group-id_中文  ");
  let getterCalls = 0, coercions = 0;
  state.scenarioCountriesByTag.TAG = { get base_iso2() { getterCalls++; return { toString() { coercions++; return "RU"; } }; } };
  assert.equal(model.resolveScenarioInspectorGroupMeta("TAG").id, "");
  assert.ok(getterCalls > 0);
  assert.equal(coercions, 0);
  state.scenarioCountriesByTag.TAG = { base_iso2: " r-u " };
  assert.equal(model.resolveScenarioInspectorGroupMeta("TAG").id, "");
  state.scenarioCountriesByTag.TAG = { base_iso2: " ru " };
  assert.equal(model.resolveScenarioInspectorGroupMeta("TAG").id, "scenario_group_russia_region");
  state.scenarioCountriesByTag.TAG = { tag: " ", base_iso2: "RU" };
  assert.equal(model.resolveScenarioInspectorGroupMeta({ code: "TAG", tag: "RUS" }).id, "", "existing truthy whitespace tag still takes precedence before normalization");
});

test("country metadata remains borrowed and follows live scenario and grouping replacements", () => {
  const scenario = { nested: { live: true } }, grouping = { continentId: "europe" };
  const state = { activeScenarioId: "example", scenarioCountriesByTag: { GB: scenario }, countryGroupMetaByCode: new Map([["GB", grouping]]) };
  const model = createModel(state);
  assert.equal(model.getScenarioCountryMeta("UK"), scenario);
  assert.equal(model.getCountryGroupingMeta("UK"), grouping);
  model.getScenarioCountryMeta("UK").nested.live = false;
  assert.equal(scenario.nested.live, false);
  model.getCountryGroupingMeta("UK").continentId = "changed";
  assert.equal(grouping.continentId, "changed");
  state.scenarioCountriesByTag = { GB: { tag: "replacement" } };
  state.countryGroupMetaByCode = new Map([["GB", { continentId: "replacement" }]]);
  assert.equal(model.getScenarioCountryMeta("UK"), state.scenarioCountriesByTag.GB);
  assert.equal(model.getCountryGroupingMeta("UK"), state.countryGroupMetaByCode.get("GB"));
  state.activeScenarioId = "";
  assert.equal(model.getScenarioCountryMeta("UK"), null);
});
