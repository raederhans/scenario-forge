import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "acorn";
import { full } from "acorn-walk";

export const CSV_LEGEND_ACTION_PATH = "js/core/state/actions/legend_actions.js";
export const CSV_ZONE_ACTION_PATH = "js/core/state/actions/special_zone_actions.js";
const fingerprints = Object.freeze({
  [CSV_LEGEND_ACTION_PATH]: "e82ac9f6585dbdfba302ccc39cdfaa85d97311fa6f5e5a9890bc4427f2002992",
  [CSV_ZONE_ACTION_PATH]: "7954e77106896b586ce1079ba7f41805859875b983474eafa02e8776296881e1",
  "js/core/history_manager.js": "dd13d491044fbf1195333cb7721c45986e8ab1e6d7b7c4978d7657a6b4acdea5",
  "js/core/legend_csv_import_transaction.js": "26a79b83e9f42b4764ca98f0539c442bf93eea869aa05e9a0b3ae51fd9443886",
  "js/core/legend_csv_schema.js": "21199ccd1394d13e55c66e4c7097a791a705ce7dd7ba642c642b462a8872faa4",
  "js/core/legend_state_normalizers.js": "89f35bd0e8cffb5e599183d4055b4a57fa43dfe8125d39c663f1e33a9087810f",
  "js/core/color_hex_utils.js": "925fe10aa8433ccab2880057e64bdf7407554d893f0409a521229c1f7857a510",
});
const normalize = source => String(source).replace(/\r\n?/g, "\n");
const hash = source => createHash("sha256").update(normalize(source)).digest("hex");
const parseModule = source => parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
const functionNamed = (ast, name) => ast.body.map(node => node.declaration || node)
  .find(node => node.type === "FunctionDeclaration" && node.id?.name === name);
const nodes = (root, predicate) => { const matches = []; full(root, node => { if (predicate(node)) matches.push(node); }); return matches; };
const directCall = (node, name) => node.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === name;
const memberCall = (node, owner, name) => node.type === "CallExpression" && node.callee?.type === "MemberExpression"
  && !node.callee.computed && node.callee.object?.name === owner && node.callee.property?.name === name;

export function csvActionInputSiteKey(exportName, parameterName, parameterIndex, parameterPath, line, column) {
  return [exportName, parameterName, parameterIndex, parameterPath, line, column].join(":");
}

// Five exact argument sites only. This grants no method-name permission and
// does not call the action, its helper, or an entire producer a pure reader.
export function inspectStateCsvActionInputSites(modulePath, source, {
  readSource = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
} = {}) {
  const sites = new Set(), operations = [], violations = [];
  if (![CSV_LEGEND_ACTION_PATH, CSV_ZONE_ACTION_PATH].includes(modulePath)) return { sites, violations, receipt: null };
  try {
    const sources = new Map();
    for (const [path, expected] of Object.entries(fingerprints)) {
      const text = normalize(path === modulePath ? source : readSource(path));
      sources.set(path, text);
      if (hash(text) !== expected) violations.push({ code: "csv-action-input-source-drift", modulePath: path });
    }
    if (violations.length) return { sites, violations, receipt: null };
    const current = sources.get(modulePath), ast = parseModule(current);
    const text = node => current.slice(node.start, node.end);
    // Intrinsic names may not be shadowed or replaced in this source binding.
    for (const node of nodes(ast, node => ["VariableDeclarator", "FunctionDeclaration", "ImportSpecifier", "AssignmentExpression"].includes(node.type))) {
      const name = node.id?.name || node.local?.name || node.left?.name;
      if (["JSON", "Number"].includes(name)) throw Error("intrinsic binding changed");
    }
    const history = sources.get("js/core/history_manager.js");
    if (!history.includes('snapshot.legendLabelKeysPresent = JSON.stringify(legendKeys.filter(key => Object.hasOwn(runtimeState.legendLabels || {}, key)))')
      || !history.includes('snapshot.specialZoneLegendFields = JSON.stringify(Object.fromEntries(selected))')) throw Error("history publication is not primitive text");
    const add = (exportName, parameterName, parameterIndex, argument, proofKind) => {
      const { line, column } = argument.loc.start;
      sites.add(csvActionInputSiteKey(exportName, parameterName, parameterIndex, "$", line, column + 1));
      operations.push(Object.freeze({ exportName, parameterName, parameterIndex, parameterPath: "$", line, column: column + 1, proofKind }));
    };
    const guardedDecode = (name, parameterName, index) => {
      const fn = functionNamed(ast, name);
      if (!fn || fn.params[index]?.name !== parameterName) throw Error("decode parameter changed");
      const body = text(fn), reject = name === "restoreLegendLabelSnapshotState" ? "false" : "[]";
      const guard = `if (typeof ${parameterName} !== "string") return ${reject};`;
      const calls = nodes(fn, node => memberCall(node, "JSON", "parse"));
      if (calls.length !== 1 || calls[0].arguments.length !== 1 || calls[0].arguments[0]?.name !== parameterName
        || body.indexOf(guard) < 0 || body.indexOf(guard) > body.indexOf(`JSON.parse(${parameterName})`)) throw Error("string guard or decoder changed");
      if (name === "restoreLegendLabelSnapshotState"
        && (!body.includes('if (presentKeys !== undefined)')
          || !body.includes('if (!Array.isArray(keys) || keys.some(key => typeof key !== "string")) return false;')
          || !body.includes('present = new Set(keys.map(normalizeColor).filter(Boolean));'))) throw Error("presence validation changed");
      add(name, parameterName, index, calls[0].arguments[0], "primitive-string-json-decode-no-reviver");
    };
    if (modulePath === CSV_LEGEND_ACTION_PATH) {
      guardedDecode("restoreLegendLabelSnapshotState", "presentKeys", 2);
    } else {
      guardedDecode("restoreSpecialZoneLegendSnapshotState", "snapshotJson", 1);
      const wrapper = functionNamed(ast, "patchSpecialZoneLegendFieldsState");
      const helper = functionNamed(ast, "applySpecialZoneLegendFieldsState");
      const restore = functionNamed(ast, "restoreSpecialZoneLegendFieldsWithPresence");
      const edge = wrapper?.body.body[0]?.argument;
      if (wrapper?.body.body.length !== 1 || !directCall(edge, "applySpecialZoneLegendFieldsState")
        || edge.arguments.length !== 3 || edge.arguments[0]?.name !== "target" || edge.arguments[1]?.name !== "patchesById"
        || edge.arguments[2]?.type !== "Literal" || edge.arguments[2].value !== false || helper?.params[2]?.name !== "restoreMissing") throw Error("literal false action edge changed");
      const restoreCalls = nodes(ast, node => directCall(node, "restoreSpecialZoneLegendFieldsWithPresence"));
      const guardedBranch = nodes(helper, node => node.type === "IfStatement"
        && text(node.test).startsWith('restoreMissing && presence &&')
        && nodes(node.consequent, node => directCall(node, "restoreSpecialZoneLegendFieldsWithPresence")).length === 1);
      if (restoreCalls.length !== 1 || guardedBranch.length !== 1) throw Error("restore-only reachability changed");
      const setSites = nodes(restore, node => node.type === "NewExpression" && node.callee?.name === "Set");
      const cloneSites = nodes(restore, node => directCall(node, "cloneSpecialZoneLegendSnapshotValue") && node.arguments[0]?.name === "value");
      if (setSites.length !== 1 || setSites[0].arguments.length !== 1 || text(setSites[0].arguments[0]) !== "presence.styleKeys"
        || cloneSites.length !== 1) throw Error("restore-only argument sites changed");
      add("patchSpecialZoneLegendFieldsState", "patchesById", 1, setSites[0].arguments[0], "unreachable-under-literal-false-call-edge");
      add("patchSpecialZoneLegendFieldsState", "patchesById", 1, cloneSites[0].arguments[0], "unreachable-under-literal-false-call-edge");
      const finite = nodes(helper, node => memberCall(node, "Number", "isFinite"));
      const guards = nodes(helper, node => node.type === "LogicalExpression" && node.operator === "&&"
        && text(node.left) === 'typeof value === "number"' && node.right === finite[0]);
      const values = nodes(helper, node => node.type === "VariableDeclarator" && node.id?.name === "value");
      if (finite.length !== 1 || finite[0].arguments.length !== 1 || finite[0].arguments[0]?.name !== "value"
        || guards.length !== 1 || values.length !== 1 || text(values[0].init) !== "stylePatch[key]") throw Error("finite scalar binding or dominating type guard changed");
      add("patchSpecialZoneLegendFieldsState", "patchesById", 1, finite[0].arguments[0], "same-binding-primitive-number-finite-read");
    }
    return { sites, violations, receipt: Object.freeze({ modulePath, sourceFingerprint: hash(current),
      operations: Object.freeze(operations), historyStorage: "primitive JSON text", decodedStorage: "invocation-local JSON data",
      producerEffects: "Snapshot capture can invoke existing getter/toJSON hooks before serialization; those calls are not exempted by this receipt.",
      knownConsumers: Object.freeze(["js/core/history_manager.js", "js/core/legend_csv_import_transaction.js"]) }) };
  } catch (error) {
    return { sites: new Set(), receipt: null, violations: [...violations, { code: "csv-action-input-proof-invalid", message: error.message }] };
  }
}
