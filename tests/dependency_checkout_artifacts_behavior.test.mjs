import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  assertCloseoutValidatorManifest,
  assertPythonCoreProfile,
  buildCloseoutValidatorManifest,
  buildPythonCoreProfile,
  closeoutBundleDescriptor,
  discoverCloseoutValidatorClosure,
  writeCloseoutValidatorBundle,
  writePythonCoreArtifacts,
} from "../tools/verification/dependency_checkout_artifacts.mjs";

const CORE_LOCK = [
  "attrs==26.1.0",
  "jsonschema==4.26.0",
  "jsonschema-specifications==2025.9.1",
  "referencing==0.37.0",
  "rpds-py==2026.5.1",
  "",
].join("\n");

function coreFixture(lockText = CORE_LOCK) {
  const canonical = { commands: [] };
  const pythonAudit = {
    roots: [{
      path: "tests/test_contract.py",
      verdict: "external-or-unresolved",
      thirdPartyImports: ["jsonschema"],
      unresolvedDynamicImports: [],
      parseErrors: [],
    }],
  };
  const assignments = [{
    commandRef: "python -m unittest tests.test_contract -q",
    profileId: "python-core",
    pythonRoots: ["tests/test_contract.py"],
  }];
  return buildPythonCoreProfile({
    canonical,
    pythonAudit,
    assignments,
    requirementsLockText: lockText,
  });
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function temporaryRoot(t) {
  const parent = path.resolve(".runtime/tmp/dependency-checkout-artifacts");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "test-"));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function coreOutputs(outRoot) {
  return {
    outRoot,
    profileOut: path.join(outRoot, "python-core-profile.json"),
    lockOut: path.join(outRoot, "requirements-python-core.lock.txt"),
  };
}

test("python-core output removes only its stale lock across ready/blocked/ready reuse", (t) => {
  const outputs = coreOutputs(temporaryRoot(t));
  const sibling = path.join(outputs.outRoot, "keep.txt");
  fs.writeFileSync(sibling, "unowned");
  writePythonCoreArtifacts(coreFixture(), outputs);
  assert.equal(fs.readFileSync(outputs.lockOut, "utf8"), CORE_LOCK);
  const blocked = coreFixture(CORE_LOCK.replace("rpds-py==2026.5.1\n", ""));
  assert.equal(writePythonCoreArtifacts(blocked, outputs).lockOut, null);
  assert.equal(fs.existsSync(outputs.lockOut), false);
  assert.equal(JSON.parse(fs.readFileSync(outputs.profileOut, "utf8")).status, "blocked");
  assert.equal(fs.readFileSync(sibling, "utf8"), "unowned");
  writePythonCoreArtifacts(coreFixture(), outputs);
  assert.equal(fs.readFileSync(outputs.lockOut, "utf8"), CORE_LOCK);
});

test("python-core blocked first output succeeds without a lock", (t) => {
  const outputs = coreOutputs(path.join(temporaryRoot(t), "new-output"));
  writePythonCoreArtifacts(coreFixture(""), outputs);
  assert.equal(fs.existsSync(outputs.lockOut), false);
  assert.equal(JSON.parse(fs.readFileSync(outputs.profileOut, "utf8")).status, "blocked");
});

test("python-core output rejects unowned paths and directories before changing files", (t) => {
  const root = temporaryRoot(t);
  const outputs = coreOutputs(path.join(root, "output"));
  fs.mkdirSync(outputs.outRoot);
  const outside = path.join(root, "requirements-python-core.lock.txt");
  const sibling = path.join(outputs.outRoot, "keep.txt");
  fs.writeFileSync(outside, "outside");
  fs.writeFileSync(sibling, "unowned");
  for (const lockOut of [outside, sibling, outputs.profileOut]) {
    assert.throws(() => writePythonCoreArtifacts(coreFixture(""), { ...outputs, lockOut }),
      /python-core-output-path-invalid/u);
  }
  assert.throws(() => writePythonCoreArtifacts(coreFixture(""), { ...outputs, outRoot: "" }),
    /python-core-output-path-invalid/u);
  fs.mkdirSync(outputs.lockOut);
  assert.throws(() => writePythonCoreArtifacts(coreFixture(""), outputs),
    /python-core-output-path-invalid/u);
  assert.equal(fs.existsSync(outputs.profileOut), false);
  assert.equal(fs.readFileSync(outside, "utf8"), "outside");
  assert.equal(fs.readFileSync(sibling, "utf8"), "unowned");
});

test("python-core output rejects a junction ancestor without touching its destination", (t) => {
  const root = temporaryRoot(t);
  const destination = path.join(root, "destination");
  fs.mkdirSync(destination);
  const outputs = coreOutputs(destination);
  fs.writeFileSync(outputs.lockOut, "preserve");
  const junction = path.join(root, "junction");
  fs.symlinkSync(destination, junction, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => writePythonCoreArtifacts(coreFixture(""), coreOutputs(junction)),
    /python-core-output-path-invalid/u);
  assert.equal(fs.readFileSync(outputs.lockOut, "utf8"), "preserve");
  assert.equal(fs.existsSync(outputs.profileOut), false);
});

test("python-core profile emits an exact minimal transitive lock", () => {
  const profile = assertPythonCoreProfile(coreFixture());
  assert.equal(profile.status, "ready");
  assert.deepEqual(profile.directDistributions, ["jsonschema"]);
  assert.deepEqual(profile.pins, CORE_LOCK.trim().split("\n"));
  assert.equal(profile.pythonRuntime.minimumVersion, "3.12");
  assert.match(profile.dependencyPolicy.digest, /^[0-9a-f]{64}$/u);
  assert.match(profile.lockSha256, /^[0-9a-f]{64}$/u);
});

test("python-core profile fails closed on a missing transitive pin", () => {
  const profile = assertPythonCoreProfile(coreFixture(CORE_LOCK.replace("rpds-py==2026.5.1\n", "")));
  assert.equal(profile.status, "blocked");
  assert.ok(profile.blockers.includes("missing-lock-pin:rpds-py"));
  assert.deepEqual(profile.pins, []);
  assert.equal(profile.lockSha256, null);
});

test("closeout validator bundle binds every closure byte to an exact Git SHA and tree", (t) => {
  const root = temporaryRoot(t);
  fs.mkdirSync(path.join(root, "tools"), { recursive: true });
  fs.writeFileSync(path.join(root, "tools", "entry.mjs"), "import { value } from './helper.mjs';\nconsole.log(value);\n");
  fs.writeFileSync(path.join(root, "tools", "helper.mjs"), "export const value = 1;\n");
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "m11@example.invalid"]);
  git(root, ["config", "user.name", "M11 Test"]);
  git(root, ["add", "tools/entry.mjs", "tools/helper.mjs"]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  const expectedSha = git(root, ["rev-parse", "HEAD"]);
  const expectedTree = git(root, ["rev-parse", "HEAD^{tree}"]);
  const manifest = assertCloseoutValidatorManifest(buildCloseoutValidatorManifest({
    repoRoot: root,
    entrypoint: "tools/entry.mjs",
    expectedSha,
    expectedTree,
  }));
  assert.equal(manifest.status, "complete");
  assert.deepEqual(manifest.files.map((entry) => entry.path), ["tools/entry.mjs", "tools/helper.mjs"]);
  assert.match(manifest.manifestDigest, /^[0-9a-f]{64}$/u);
  assert.throws(() => buildCloseoutValidatorManifest({
    repoRoot: root,
    entrypoint: "tools/entry.mjs",
    expectedSha,
    expectedTree: expectedSha,
  }), /validator-closure-source-binding-mismatch/u);
  const bundleRoot = path.join(root, ".runtime", "bundle");
  const manifestPath = writeCloseoutValidatorBundle(manifest, { repoRoot: root, bundleRoot });
  assert.ok(fs.existsSync(manifestPath));
  assert.equal(
    closeoutBundleDescriptor(manifest, {
      artifactIdentityBound: true,
      allInputsArtifactLocal: true,
      immutableDownloadNames: true,
      runtimeProvided: true,
    }).manifestValidated,
    true,
  );

  fs.rmSync(path.join(root, "tools", "helper.mjs"));
  const rebound = buildCloseoutValidatorManifest({
    repoRoot: root,
    entrypoint: "tools/entry.mjs",
    expectedSha,
    expectedTree,
  });
  assert.equal(rebound.status, "complete");
  const reboundBundle = path.join(root, ".runtime", "rebound-bundle");
  writeCloseoutValidatorBundle(rebound, { repoRoot: root, bundleRoot: reboundBundle });
  assert.equal(
    fs.readFileSync(path.join(reboundBundle, "tools", "helper.mjs"), "utf8"),
    "export const value = 1;\n",
  );
});

test("template-expression dynamic imports block validator closure completeness", (t) => {
  const root = temporaryRoot(t);
  fs.mkdirSync(path.join(root, "tools"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "tools", "entry.mjs"),
    "const output = `${await import('./helper.mjs')}`;\nexport default output;\n",
  );
  fs.writeFileSync(path.join(root, "tools", "helper.mjs"), "export default 1;\n");

  const closure = discoverCloseoutValidatorClosure({ repoRoot: root, entrypoint: "tools/entry.mjs" });

  assert.equal(closure.dynamicImportGaps.length, 1);
  assert.deepEqual(closure.files, ["tools/entry.mjs"]);
});

test("repository closeout validator bundle imports without a checkout", (t) => {
  const expectedSha = git(process.cwd(), ["rev-parse", "HEAD"]);
  const expectedTree = git(process.cwd(), ["rev-parse", "HEAD^{tree}"]);
  const manifest = assertCloseoutValidatorManifest(buildCloseoutValidatorManifest({
    expectedSha,
    expectedTree,
  }));
  assert.equal(manifest.status, "complete");
  assert.equal(manifest.blockers.length, 0);
  assert.ok(manifest.files.length >= 5);
  const bundleRoot = temporaryRoot(t);
  writeCloseoutValidatorBundle(manifest, { bundleRoot });
  const entrypointUrl = pathToFileURL(path.join(bundleRoot, manifest.entrypoint)).href;
  execFileSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `await import(${JSON.stringify(entrypointUrl)})`,
  ], { cwd: bundleRoot, stdio: "pipe" });
});
