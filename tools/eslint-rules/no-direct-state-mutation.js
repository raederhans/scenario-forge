const fs = require("fs");
const path = require("path");

const STATE_MEMBER_ASSIGN_RE = /\bstate\.(?<key>[A-Za-z_$][\w$]*)\s*=(?!=)/g;
const STATE_OBJECT_ASSIGN_RE = /\bObject\.assign\s*\(\s*state\s*,/g;

function normalizeRelativePath(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function scanContentForStateWrites(content = "") {
  const violations = [];
  let match = null;
  STATE_MEMBER_ASSIGN_RE.lastIndex = 0;
  while ((match = STATE_MEMBER_ASSIGN_RE.exec(content)) !== null) {
    violations.push({
      type: "member-assign",
      key: match.groups?.key || "",
      index: match.index,
      text: match[0],
    });
  }

  STATE_OBJECT_ASSIGN_RE.lastIndex = 0;
  while ((match = STATE_OBJECT_ASSIGN_RE.exec(content)) !== null) {
    violations.push({
      type: "object-assign",
      key: "",
      index: match.index,
      text: match[0],
    });
  }
  return violations;
}

function loadAllowlist(allowlistPath) {
  const raw = fs.readFileSync(allowlistPath, "utf8");
  const payload = JSON.parse(raw);
  const files = Array.isArray(payload?.files) ? payload.files : [];
  return new Set(files.map(normalizeRelativePath));
}

function createRule({ allowlistPath } = {}) {
  return {
    meta: {
      type: "problem",
      docs: {
        description: "Guard direct root state writes behind the temporary allowlist.",
      },
      schema: [],
    },
    create(context) {
      const filename = normalizeRelativePath(path.relative(process.cwd(), context.getFilename?.() || ""));
      const allowlist = allowlistPath && fs.existsSync(allowlistPath)
        ? loadAllowlist(allowlistPath)
        : new Set();
      if (allowlist.has(filename)) {
        return {};
      }
      return {
        AssignmentExpression(node) {
          if (
            node?.left?.type === "MemberExpression"
            && node.left.object?.type === "Identifier"
            && node.left.object.name === "state"
          ) {
            context.report({
              node,
              message: "Direct root state writes must stay on the temporary allowlist.",
            });
          }
        },
        CallExpression(node) {
          if (
            node?.callee?.type === "MemberExpression"
            && node.callee.object?.type === "Identifier"
            && node.callee.object.name === "Object"
            && node.callee.property?.type === "Identifier"
            && node.callee.property.name === "assign"
            && node.arguments?.[0]?.type === "Identifier"
            && node.arguments[0].name === "state"
          ) {
            context.report({
              node,
              message: "Object.assign(state, ...) must stay on the temporary allowlist.",
            });
          }
        },
      };
    },
  };
}

module.exports = {
  STATE_MEMBER_ASSIGN_RE,
  STATE_OBJECT_ASSIGN_RE,
  createRule,
  loadAllowlist,
  normalizeRelativePath,
  scanContentForStateWrites,
};
