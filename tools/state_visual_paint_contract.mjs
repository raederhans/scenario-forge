import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "acorn";
import { full } from "acorn-walk";

export const VISUAL_PAINT_ACTION_PATH = "js/core/state/actions/visual_paint_actions.js";
export const VISUAL_PAINT_ACTION_SOURCE_FINGERPRINT = "32273f24a217d48cb9d2afcdaa17e534987320c7359e3614652bb05bcb2ca618";
const fingerprint = (source) => createHash("sha256").update(String(source).replace(/\r\n?/g, "\n")).digest("hex");
const dependencies = Object.freeze({
  "js/core/color_hex_utils.js": "925fe10aa8433ccab2880057e64bdf7407554d893f0409a521229c1f7857a510",
  "js/core/river_paint/partition_model.js": "3ec6a9e6c13ed80c73fa9baaa324e75b1df678f7cd0ed34191f9ebb1f40fc8f1",
  "js/core/river_paint/geometry_identity.js": "2e4562a87beecfb75273458038fb1d9cc9d092592551fbf2fef4e83af573ff78",
});

// The action body was transferred verbatim from color_state at 311e5dfe. This
// proof covers only ID-to-string projection and the fixed scalar normalizer.
// It gives no permission to modify an input or to publish it to another call.
export function inspectVisualPaintInputSites(source, {
  readSource = (modulePath) => readFileSync(new URL(`../${modulePath}`, import.meta.url), "utf8"),
} = {}) {
  const sites = new Set();
  const violations = [];
  if (fingerprint(source) !== VISUAL_PAINT_ACTION_SOURCE_FINGERPRINT) {
    return { sites, violations: [{ code: "visual-paint-action-source-drift" }] };
  }
  for (const [modulePath, expected] of Object.entries(dependencies)) {
    try {
      if (fingerprint(readSource(modulePath)) !== expected) violations.push({ code: "visual-paint-dependency-drift", modulePath });
    } catch {
      violations.push({ code: "visual-paint-dependency-unavailable", modulePath });
    }
  }
  if (violations.length) return { sites, violations };
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  const fn = ast.body.find((node) => node.type === "ExportNamedDeclaration"
    && node.declaration?.id?.name === "applyFeaturePaintState")?.declaration;
  if (!fn || fingerprint(source.slice(fn.start, fn.end)) !== "02c60e0d00d2d3be09107fa279423dfa4ceb9231fcf27d4488f3be7dbabb733c") {
    return { sites, violations: [{ code: "visual-paint-body-transfer-drift" }] };
  }
  full(fn.body, (node) => {
    if (node.type !== "CallExpression") return;
    const expression = source.slice(node.start, node.end);
    if (expression === 'featureIds.map((id) => String(id ?? "").trim())') {
      sites.add(`featureIds:1:unsupported-call-mutation::${node.loc.start.line}:${node.loc.start.column + 1}`);
    }
    if (expression === "normalizeHexColor(value)") {
      const argument = node.arguments[0];
      sites.add(`value:2:state-alias-escape:unknown-call-argument:${argument.loc.start.line}:${argument.loc.start.column + 1}`);
    }
  });
  if (sites.size !== 2) return { sites: new Set(), violations: [{ code: "visual-paint-input-site-drift" }] };
  return { sites, violations };
}
