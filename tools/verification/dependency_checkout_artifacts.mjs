import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { builtinModules } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  VERIFICATION_METADATA_SOURCE,
  VERIFICATION_METADATA_SOURCE_IDENTITY,
} from "./verification_catalog_source.mjs";
import {
  deriveCanonicalProfileInputs,
  deriveDependencyAssignments,
  runPythonImportClosureAudit,
} from "./dependency_checkout_profiles.mjs";

const REPO_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

export const PYTHON_CORE_PROFILE_KIND = "python-core-minimal-lock-profile";
export const CLOSEOUT_VALIDATOR_MANIFEST_KIND = "closeout-validator-closure-manifest";
export const DEPENDENCY_CHECKOUT_ARTIFACT_SUMMARY_KIND = "dependency-checkout-artifact-summary";

const IMPORT_TO_DISTRIBUTION = Object.freeze({
  jsonschema: "jsonschema",
});
const DISTRIBUTION_DEPENDENCIES = Object.freeze({
  attrs: [],
  jsonschema: ["attrs", "jsonschema-specifications", "referencing", "rpds-py"],
  "jsonschema-specifications": ["referencing"],
  referencing: ["attrs", "rpds-py"],
  "rpds-py": [],
});
const PYTHON_CORE_DEPENDENCY_POLICY = Object.freeze({
  schemaVersion: 1,
  importToDistribution: IMPORT_TO_DISTRIBUTION,
  distributionDependencies: DISTRIBUTION_DEPENDENCIES,
});

function compareText(left, right) {
  return String(left).localeCompare(String(right));
}

function stableUnique(values) {
  return [...new Set((values || []).filter(Boolean))].sort(compareText);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeDistributionName(value) {
  return String(value || "").trim().toLowerCase().replace(/[_.]+/gu, "-");
}

export function parsePinnedRequirements(lockText) {
  const pins = new Map();
  const invalidLines = [];
  for (const rawLine of String(lockText || "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_.-]+)==([^\s;]+)$/u.exec(line);
    if (!match) {
      invalidLines.push(line);
      continue;
    }
    const name = normalizeDistributionName(match[1]);
    if (pins.has(name) && pins.get(name) !== line) invalidLines.push(line);
    pins.set(name, `${name}==${match[2]}`);
  }
  return { pins, invalidLines: stableUnique(invalidLines) };
}

function dependencyClosure(distributions) {
  const pending = [...distributions];
  const closure = new Set();
  const missingPolicies = new Set();
  while (pending.length > 0) {
    const distribution = normalizeDistributionName(pending.pop());
    if (!distribution || closure.has(distribution)) continue;
    closure.add(distribution);
    if (!Object.hasOwn(DISTRIBUTION_DEPENDENCIES, distribution)) {
      missingPolicies.add(distribution);
      continue;
    }
    pending.push(...DISTRIBUTION_DEPENDENCIES[distribution]);
  }
  return {
    distributions: [...closure].sort(compareText),
    missingPolicies: [...missingPolicies].sort(compareText),
  };
}

export function buildPythonCoreProfile({
  canonical,
  pythonAudit,
  assignments = deriveDependencyAssignments(canonical, pythonAudit),
  requirementsLockText,
  requirementsLockPath = "requirements-dev.lock.txt",
  metadataSourceIdentity = VERIFICATION_METADATA_SOURCE_IDENTITY,
} = {}) {
  const auditsByRoot = new Map((pythonAudit?.roots || []).map((entry) => [entry.path, entry]));
  const coreAssignments = assignments.filter((entry) => entry.profileId === "python-core");
  const pythonRoots = stableUnique(coreAssignments.flatMap((entry) => entry.pythonRoots));
  const rootAudits = pythonRoots.map((root) => auditsByRoot.get(root)).filter(Boolean);
  const thirdPartyImports = stableUnique(rootAudits.flatMap((entry) => entry.thirdPartyImports || []));
  const unresolvedDynamicImports = stableUnique(rootAudits.flatMap(
    (entry) => entry.unresolvedDynamicImports || [],
  ));
  const parseErrors = stableUnique(rootAudits.flatMap((entry) => entry.parseErrors || []));
  const missingRootAudits = pythonRoots.filter((root) => !auditsByRoot.has(root));
  const unmappedImports = thirdPartyImports.filter((name) => !Object.hasOwn(IMPORT_TO_DISTRIBUTION, name));
  const directDistributions = stableUnique(thirdPartyImports
    .map((name) => IMPORT_TO_DISTRIBUTION[name])
    .filter(Boolean));
  const closure = dependencyClosure(directDistributions);
  const parsedLock = parsePinnedRequirements(requirementsLockText);
  const missingPins = closure.distributions.filter((name) => !parsedLock.pins.has(name));
  const blockers = stableUnique([
    ...missingRootAudits.map((root) => `missing-root-audit:${root}`),
    ...unresolvedDynamicImports.map((entry) => `unresolved-dynamic-import:${entry}`),
    ...parseErrors.map((entry) => `parse-error:${entry}`),
    ...unmappedImports.map((name) => `unmapped-import:${name}`),
    ...closure.missingPolicies.map((name) => `missing-transitive-policy:${name}`),
    ...missingPins.map((name) => `missing-lock-pin:${name}`),
    ...parsedLock.invalidLines.map((line) => `invalid-lock-line:${line}`),
  ]);
  const lockLines = blockers.length === 0
    ? closure.distributions.map((name) => parsedLock.pins.get(name))
    : [];
  const sourceLockDigest = sha256(String(requirementsLockText || ""));
  const profile = {
    schemaVersion: 1,
    kind: PYTHON_CORE_PROFILE_KIND,
    status: blockers.length === 0 ? "ready" : "blocked",
    sourceBinding: {
      metadataSourceIdentity: structuredClone(metadataSourceIdentity),
      requirementsLockPath,
      requirementsLockSha256: sourceLockDigest,
    },
    pythonRuntime: { minimumVersion: "3.12" },
    dependencyPolicy: {
      ...structuredClone(PYTHON_CORE_DEPENDENCY_POLICY),
      digest: sha256(stableJson(PYTHON_CORE_DEPENDENCY_POLICY)),
    },
    commandRefs: coreAssignments.map((entry) => entry.commandRef).sort(compareText),
    pythonRoots,
    thirdPartyImports,
    directDistributions,
    lockedDistributions: closure.distributions,
    pins: lockLines,
    lockSha256: lockLines.length > 0 ? sha256(`${lockLines.join("\n")}\n`) : null,
    blockers,
  };
  profile.profileDigest = sha256(stableJson(profile));
  return profile;
}

export function assertPythonCoreProfile(profile) {
  const body = structuredClone(profile || {});
  const observedDigest = body.profileDigest;
  delete body.profileDigest;
  const policy = body.dependencyPolicy ? structuredClone(body.dependencyPolicy) : null;
  const observedPolicyDigest = policy?.digest;
  if (policy) delete policy.digest;
  const expectedPins = [...(body.pins || [])].sort((left, right) => compareText(
    normalizeDistributionName(String(left).split("==", 1)[0]),
    normalizeDistributionName(String(right).split("==", 1)[0]),
  ));
  const expectedLockDigest = expectedPins.length > 0
    ? sha256(`${expectedPins.join("\n")}\n`)
    : null;
  if (body.schemaVersion !== 1
    || body.kind !== PYTHON_CORE_PROFILE_KIND
    || !["ready", "blocked"].includes(body.status)
    || body.pythonRuntime?.minimumVersion !== "3.12"
    || observedPolicyDigest !== sha256(stableJson(policy))
    || !/^[0-9a-f]{64}$/u.test(body.sourceBinding?.requirementsLockSha256 || "")
    || !Array.isArray(body.commandRefs)
    || !Array.isArray(body.pins)
    || !Array.isArray(body.blockers)
    || body.pins.some((line) => !/^[a-z0-9.-]+==[^\s;]+$/u.test(line))
    || JSON.stringify(body.pins) !== JSON.stringify(expectedPins)
    || body.lockSha256 !== expectedLockDigest
    || observedDigest !== sha256(stableJson(body))
    || (body.status === "ready" && (body.blockers.length > 0 || body.pins.length === 0))
    || (body.status === "blocked" && (body.blockers.length === 0 || body.pins.length > 0))) {
    throw new Error("python-core-profile-invalid");
  }
  return profile;
}

function maskStringsAndComments(source) {
  const output = [...source];
  let state = "code";
  let quote = "";
  const templateExpressionDepths = [];
  for (let index = 0; index < output.length; index += 1) {
    const char = output[index];
    const next = output[index + 1];
    if (state === "line-comment") {
      if (char === "\n") state = "code";
      else output[index] = " ";
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        output[index] = " ";
        output[index + 1] = " ";
        index += 1;
        state = "code";
      } else if (char !== "\n") output[index] = " ";
      continue;
    }
    if (state === "string") {
      if (char === "\\") {
        output[index] = " ";
        if (output[index + 1] !== "\n") output[index + 1] = " ";
        index += 1;
      } else if (quote === "`" && char === "$" && next === "{") {
        output[index] = " ";
        output[index + 1] = " ";
        index += 1;
        templateExpressionDepths.push(1);
        state = "code";
      } else if (char === quote) {
        output[index] = " ";
        state = "code";
      } else if (char !== "\n") output[index] = " ";
      continue;
    }
    if (char === "/" && next === "/") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 1;
      state = "line-comment";
    } else if (char === "/" && next === "*") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 1;
      state = "block-comment";
    } else if (["'", '"', "`"].includes(char)) {
      quote = char;
      output[index] = " ";
      state = "string";
    } else if (templateExpressionDepths.length > 0 && char === "{") {
      templateExpressionDepths[templateExpressionDepths.length - 1] += 1;
    } else if (templateExpressionDepths.length > 0 && char === "}") {
      const depthIndex = templateExpressionDepths.length - 1;
      templateExpressionDepths[depthIndex] -= 1;
      if (templateExpressionDepths[depthIndex] === 0) {
        output[index] = " ";
        templateExpressionDepths.pop();
        quote = "`";
        state = "string";
      }
    }
  }
  return output.join("");
}

function extractModuleSpecifiers(source) {
  const specifiers = [];
  const maskedSource = maskStringsAndComments(source);
  const patterns = [
    /^(?:[ \t]*)(?:import|export)[ \t]+[^;]*?[ \t]from[ \t]*["']([^"']+)["']/gmu,
    /^(?:[ \t]*)import[ \t]*["']([^"']+)["']/gmu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const maskedMatch = maskedSource.slice(match.index, match.index + match[0].length);
      if (/^[ \t]*(?:import|export)\b/u.test(maskedMatch)) specifiers.push(match[1]);
    }
  }
  const dynamicGaps = [];
  for (const pattern of [
    /\bimport\s*\(/gu,
    /\brequire\s*\(/gu,
  ]) {
    for (const match of maskedSource.matchAll(pattern)) dynamicGaps.push(match.index);
  }
  return { specifiers: stableUnique(specifiers), dynamicGaps: stableUnique(dynamicGaps) };
}

function resolveLocalSpecifier(importerPath, specifier, repoRoot, fileExists) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(importerPath), specifier);
  const candidates = path.extname(base)
    ? [base]
    : [base, `${base}.mjs`, `${base}.js`, `${base}.json`, path.join(base, "index.mjs"), path.join(base, "index.js")];
  const resolved = candidates.find((candidate) => fileExists(candidate));
  if (!resolved) return null;
  const relative = path.relative(repoRoot, resolved).replaceAll("\\", "/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) return null;
  return resolved;
}

export function discoverCloseoutValidatorClosure({
  repoRoot = REPO_ROOT,
  entrypoint = "tools/verification/p4_nightly_closeout.mjs",
  sourceReader = (filePath) => fs.readFileSync(filePath, "utf8"),
  fileExists = (filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile(),
} = {}) {
  const absoluteRoot = path.resolve(repoRoot);
  const absoluteEntrypoint = path.resolve(absoluteRoot, entrypoint);
  const pending = [absoluteEntrypoint];
  const visited = new Set();
  const unresolvedImports = [];
  const externalImports = [];
  const dynamicImportGaps = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    if (!fileExists(current)) {
      unresolvedImports.push(path.relative(absoluteRoot, current).replaceAll("\\", "/"));
      continue;
    }
    visited.add(current);
    if (path.extname(current) === ".json") continue;
    const source = sourceReader(current);
    const imports = extractModuleSpecifiers(source);
    const currentRelative = path.relative(absoluteRoot, current).replaceAll("\\", "/");
    dynamicImportGaps.push(...imports.dynamicGaps.map((offset) => `${currentRelative}:${offset}`));
    for (const specifier of imports.specifiers) {
      if (NODE_BUILTINS.has(specifier)) continue;
      if (!specifier.startsWith(".")) {
        externalImports.push(`${currentRelative}:${specifier}`);
        continue;
      }
      const resolved = resolveLocalSpecifier(current, specifier, absoluteRoot, fileExists);
      if (!resolved) unresolvedImports.push(`${currentRelative}:${specifier}`);
      else pending.push(resolved);
    }
  }
  return {
    entrypoint,
    files: [...visited].map((filePath) => path.relative(absoluteRoot, filePath).replaceAll("\\", "/"))
      .sort(compareText),
    unresolvedImports: stableUnique(unresolvedImports),
    externalImports: stableUnique(externalImports),
    dynamicImportGaps: stableUnique(dynamicImportGaps),
  };
}

function gitOutput(args, { cwd, runner = spawnSync, encoding = "utf8" } = {}) {
  const result = runner("git", args, { cwd, encoding, shell: false, maxBuffer: 32 * 1024 * 1024 });
  if (result?.error || result?.status !== 0) {
    throw new Error(`validator-closure-git-failed:${args.join(" ")}:${result?.stderr || result?.error || ""}`);
  }
  return result.stdout;
}

export function buildCloseoutValidatorManifest({
  repoRoot = REPO_ROOT,
  expectedSha,
  expectedTree,
  entrypoint = "tools/verification/p4_nightly_closeout.mjs",
  runner = spawnSync,
} = {}) {
  if (!/^[0-9a-f]{40}$/iu.test(expectedSha || "") || !/^[0-9a-f]{40}$/iu.test(expectedTree || "")) {
    throw new Error("validator-closure-exact-source-binding-required");
  }
  const resolvedSha = String(gitOutput(["rev-parse", `${expectedSha}^{commit}`], {
    cwd: repoRoot,
    runner,
  })).trim().toLowerCase();
  const resolvedTree = String(gitOutput(["rev-parse", `${expectedSha}^{tree}`], {
    cwd: repoRoot,
    runner,
  })).trim().toLowerCase();
  if (resolvedSha !== expectedSha.toLowerCase() || resolvedTree !== expectedTree.toLowerCase()) {
    throw new Error("validator-closure-source-binding-mismatch");
  }
  const committedBytesByPath = new Map();
  const trackedFiles = new Set(String(gitOutput(["ls-tree", "-r", "--name-only", resolvedSha], {
    cwd: repoRoot,
    runner,
  })).split(/\r?\n/u).filter(Boolean));
  const readCommittedBytes = (repoPath) => {
    if (committedBytesByPath.has(repoPath)) return committedBytesByPath.get(repoPath);
    const bytes = Buffer.from(gitOutput(["show", `${resolvedSha}:${repoPath}`], {
      cwd: repoRoot,
      runner,
      encoding: null,
    }));
    committedBytesByPath.set(repoPath, bytes);
    return bytes;
  };
  const closure = discoverCloseoutValidatorClosure({
    repoRoot,
    entrypoint,
    sourceReader: (filePath) => {
      const repoPath = path.relative(repoRoot, filePath).replaceAll("\\", "/");
      return readCommittedBytes(repoPath).toString("utf8");
    },
    fileExists: (filePath) => {
      const repoPath = path.relative(repoRoot, filePath).replaceAll("\\", "/");
      return trackedFiles.has(repoPath);
    },
  });
  const files = closure.files.map((repoPath) => {
    const committedBytes = readCommittedBytes(repoPath);
    return {
      path: repoPath,
      bytes: committedBytes.length,
      sha256: sha256(committedBytes),
      sourceBindingVerified: true,
    };
  });
  const blockers = stableUnique([
    ...closure.unresolvedImports.map((entry) => `unresolved-import:${entry}`),
    ...closure.externalImports.map((entry) => `external-import:${entry}`),
    ...closure.dynamicImportGaps.map((entry) => `dynamic-import-gap:${entry}`),
  ]);
  const manifest = {
    schemaVersion: 1,
    kind: CLOSEOUT_VALIDATOR_MANIFEST_KIND,
    status: blockers.length === 0 ? "complete" : "blocked",
    sourceBinding: {
      expectedSha: resolvedSha,
      expectedTree: resolvedTree,
      bindingMode: "git-commit-tree-and-blob-bytes",
    },
    entrypoint,
    bundleLayout: "repository-relative",
    runtime: { executable: "node", minimumMajor: 20 },
    requiresRepositoryRead: false,
    files,
    closureDigest: sha256(stableJson(files.map(({ path: filePath, bytes, sha256: digest }) => ({
      path: filePath,
      bytes,
      sha256: digest,
    })))),
    blockers,
  };
  manifest.manifestDigest = sha256(stableJson(manifest));
  return manifest;
}

export function assertCloseoutValidatorManifest(manifest) {
  const body = structuredClone(manifest || {});
  const observedDigest = body.manifestDigest;
  delete body.manifestDigest;
  const filePaths = body.files?.map((entry) => entry.path) || [];
  const closureEntries = body.files?.map(({ path: filePath, bytes, sha256: digest }) => ({
    path: filePath,
    bytes,
    sha256: digest,
  })) || [];
  const safeRepoPath = (value) => typeof value === "string"
    && value.length > 0
    && !value.includes("\\")
    && !path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && value !== ".."
    && !value.startsWith("../");
  if (body.schemaVersion !== 1
    || body.kind !== CLOSEOUT_VALIDATOR_MANIFEST_KIND
    || !["complete", "blocked"].includes(body.status)
    || !Array.isArray(body.files)
    || !Array.isArray(body.blockers)
    || !/^[0-9a-f]{40}$/u.test(body.sourceBinding?.expectedSha || "")
    || !/^[0-9a-f]{40}$/u.test(body.sourceBinding?.expectedTree || "")
    || body.sourceBinding?.bindingMode !== "git-commit-tree-and-blob-bytes"
    || body.requiresRepositoryRead !== false
    || !safeRepoPath(body.entrypoint)
    || !filePaths.includes(body.entrypoint)
    || filePaths.length !== new Set(filePaths).size
    || JSON.stringify(filePaths) !== JSON.stringify([...filePaths].sort(compareText))
    || body.files.some((entry) => (!Number.isInteger(entry.bytes)
      || entry.bytes < 0
      || !safeRepoPath(entry.path)
      || !/^[0-9a-f]{64}$/u.test(entry.sha256 || "")
      || entry.sourceBindingVerified !== true))
    || body.closureDigest !== sha256(stableJson(closureEntries))
    || observedDigest !== sha256(stableJson(body))
    || (body.status === "complete" && (body.blockers.length > 0
      || body.files.length === 0))
    || (body.status === "blocked" && body.blockers.length === 0)) {
    throw new Error("closeout-validator-manifest-invalid");
  }
  return manifest;
}

export function closeoutBundleDescriptor(manifest, {
  artifactIdentityBound = false,
  allInputsArtifactLocal = false,
  immutableDownloadNames = false,
  runtimeProvided = false,
} = {}) {
  assertCloseoutValidatorManifest(manifest);
  return {
    manifestValidated: manifest.status === "complete",
    artifactIdentityBound,
    allInputsArtifactLocal,
    immutableDownloadNames,
    runtimeProvided,
    requiresRepositoryRead: manifest.requiresRepositoryRead,
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validatePythonCoreOutput(outRoot, output, name) {
  if (typeof outRoot !== "string" || !outRoot.trim()
    || typeof output !== "string" || !output.trim()
    || path.resolve(output) !== path.resolve(outRoot, name)) {
    throw new Error("python-core-output-path-invalid");
  }
  const target = path.resolve(output);
  for (let current = target; ; current = path.dirname(current)) {
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (stat && (stat.isSymbolicLink()
      || (current === target ? !stat.isFile() : !stat.isDirectory()))) {
      throw new Error("python-core-output-path-invalid");
    }
    if (current === path.dirname(current)) break;
  }
  return target;
}

export function writePythonCoreArtifacts(profile, { outRoot, profileOut, lockOut } = {}) {
  assertPythonCoreProfile(profile);
  profileOut = validatePythonCoreOutput(outRoot, profileOut, "python-core-profile.json");
  lockOut = validatePythonCoreOutput(outRoot, lockOut, "requirements-python-core.lock.txt");
  if (profile.status === "blocked") {
    try {
      fs.unlinkSync(lockOut);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  writeJson(profileOut, profile);
  if (profile.status === "ready") {
    fs.mkdirSync(path.dirname(lockOut), { recursive: true });
    fs.writeFileSync(lockOut, `${profile.pins.join("\n")}\n`, "utf8");
  }
  return { profileOut, lockOut: profile.status === "ready" ? lockOut : null };
}

export function writeCloseoutValidatorBundle(manifest, {
  repoRoot = REPO_ROOT,
  bundleRoot,
  runner = spawnSync,
} = {}) {
  assertCloseoutValidatorManifest(manifest);
  if (manifest.status !== "complete") throw new Error("closeout-validator-bundle-blocked");
  for (const entry of manifest.files) {
    const destination = path.resolve(bundleRoot, entry.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const bytes = gitOutput(["show", `${manifest.sourceBinding.expectedSha}:${entry.path}`], {
      cwd: repoRoot,
      runner,
      encoding: null,
    });
    if (sha256(bytes) !== entry.sha256) throw new Error(`closeout-validator-bundle-byte-drift:${entry.path}`);
    fs.writeFileSync(destination, bytes);
  }
  const manifestPath = path.resolve(bundleRoot, "validator-closure-manifest.json");
  writeJson(manifestPath, manifest);
  return manifestPath;
}

function parseArgs(argv) {
  const args = { outRoot: "", expectedSha: "", expectedTree: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--out-root") args.outRoot = argv[++index] || "";
    else if (token === "--expected-sha") args.expectedSha = argv[++index] || "";
    else if (token === "--expected-tree") args.expectedTree = argv[++index] || "";
    else throw new Error(`Unknown dependency/checkout artifact argument: ${token}`);
  }
  if (!args.outRoot) throw new Error("dependency-checkout-artifact-output-required");
  return args;
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const canonical = deriveCanonicalProfileInputs(VERIFICATION_METADATA_SOURCE);
    const pythonAudit = runPythonImportClosureAudit(canonical.pythonRoots);
    const assignments = deriveDependencyAssignments(canonical, pythonAudit);
    const pythonCoreProfile = buildPythonCoreProfile({
      canonical,
      pythonAudit,
      assignments,
      requirementsLockText: fs.readFileSync(path.join(REPO_ROOT, "requirements-dev.lock.txt"), "utf8"),
    });
    const outRoot = path.resolve(args.outRoot);
    const pythonOutputs = writePythonCoreArtifacts(pythonCoreProfile, {
      outRoot,
      profileOut: path.join(outRoot, "python-core-profile.json"),
      lockOut: path.join(outRoot, "requirements-python-core.lock.txt"),
    });
    const validatorManifest = buildCloseoutValidatorManifest({
      expectedSha: args.expectedSha,
      expectedTree: args.expectedTree,
    });
    const validatorManifestPath = writeCloseoutValidatorBundle(validatorManifest, {
      bundleRoot: path.join(outRoot, "closeout-validator-bundle"),
    });
    const summary = {
      schemaVersion: 1,
      kind: DEPENDENCY_CHECKOUT_ARTIFACT_SUMMARY_KIND,
      status: pythonCoreProfile.status === "ready" && validatorManifest.status === "complete"
        ? "ready"
        : "blocked",
      pythonCore: {
        status: pythonCoreProfile.status,
        profilePath: path.relative(REPO_ROOT, pythonOutputs.profileOut).replaceAll("\\", "/"),
        lockPath: pythonOutputs.lockOut
          ? path.relative(REPO_ROOT, pythonOutputs.lockOut).replaceAll("\\", "/")
          : null,
        profileDigest: pythonCoreProfile.profileDigest,
        blockers: pythonCoreProfile.blockers,
      },
      closeoutValidator: {
        status: validatorManifest.status,
        manifestPath: path.relative(REPO_ROOT, validatorManifestPath).replaceAll("\\", "/"),
        manifestDigest: validatorManifest.manifestDigest,
        expectedSha: validatorManifest.sourceBinding.expectedSha,
        expectedTree: validatorManifest.sourceBinding.expectedTree,
        blockers: validatorManifest.blockers,
      },
    };
    writeJson(path.join(outRoot, "artifact-summary.json"), summary);
    console.log(`Dependency/checkout artifacts: ${summary.status}`);
    console.log(`Python core: ${pythonCoreProfile.status} packages=${pythonCoreProfile.pins.length}`);
    console.log(`Closeout validator: ${validatorManifest.status} files=${validatorManifest.files.length}`);
    if (summary.status !== "ready") process.exitCode = 2;
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}
