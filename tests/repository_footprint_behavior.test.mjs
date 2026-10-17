import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildReport,
  buildTopBlobs,
  buildTopPathTotals,
  compareLargeBlobs,
  parseArgs,
  parseCountObjects,
  parseLsTree,
  resolveCommit,
  resolveEvaluationDate,
  validateManagedEvidence,
  validateManifest,
  validateReport,
} from "../tools/repository_footprint.mjs";
import { VERIFICATION_DOMAINS } from "../tools/verification/verification_domains.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FOOTPRINT_DIR = path.join(REPO_ROOT, "tools", "repository_footprint");
const OIDS = Object.freeze({
  a: "a".repeat(40),
  b: "b".repeat(40),
  c: "c".repeat(40),
  d: "d".repeat(40),
  e: "e".repeat(40),
  f: "f".repeat(40),
});

function blob(repositoryPath, oid, bytes) {
  return Object.freeze({ mode: "100644", type: "blob", path: repositoryPath, oid, bytes });
}

function manifestFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    policy: {
      mode: "report-only",
      largeBlobThresholdBytes: 100,
      topN: 3,
      pathGroupDepth: 2,
    },
    baseline: {
      commit: OIDS.a,
      trackedFileCount: 1,
      checkoutTreeBytes: 120,
    },
    managedAssets: [],
    waivers: [],
    ...overrides,
  };
}

test("CLI parser accepts only known, single-value options", () => {
  const parsed = parseArgs([
    "--ref", "candidate",
    "--base", "origin/main",
    "--as-of", "2026-08-26",
    "--manifest", "policy.json",
    "--json-out", "report.json",
    "--md-out", "report.md",
  ]);
  assert.equal(parsed.ref, "candidate");
  assert.equal(parsed.base, "origin/main");
  assert.equal(parsed.asOfDate, "2026-08-26");
  assert.equal(parsed.manifestPath, "policy.json");
  assert.throws(
    () => parseArgs(["--mystery", "value"]),
    { code: "repository-footprint-cli-unknown" },
  );
  assert.throws(
    () => parseArgs(["--base"]),
    { code: "repository-footprint-cli-value-missing" },
  );
  assert.throws(
    () => parseArgs(["--base", "main", "--base", "HEAD"]),
    { code: "repository-footprint-cli-duplicate" },
  );
  assert.throws(
    () => parseArgs(["--as-of", "2026-02-31"]),
    { code: "repository-footprint-cli-date-invalid" },
  );
  assert.equal(resolveEvaluationDate("", () => new Date("2026-08-26T23:59:59.000Z")), "2026-08-26");
});

test("ls-tree parser preserves unusual paths and rejects malformed records", () => {
  const payload = [
    `100644 blob ${OIDS.a} 12\tdata/a file.json`,
    `100755 blob ${OIDS.b} 7\ttools/line\nbreak.mjs`,
    `160000 commit ${OIDS.c} -\tvendor/submodule`,
    "",
  ].join("\0");
  const entries = parseLsTree(payload);
  assert.deepEqual(entries.map((entry) => [entry.type, entry.bytes, entry.path]), [
    ["blob", 12, "data/a file.json"],
    ["blob", 7, "tools/line\nbreak.mjs"],
    ["commit", 0, "vendor/submodule"],
  ]);
  assert.throws(
    () => parseLsTree(`100644 blob ${OIDS.a} nope\tdata/a.json\0`),
    { code: "repository-footprint-ls-tree-invalid" },
  );
  assert.throws(
    () => parseLsTree(`100644 blob ${OIDS.a} 12\tdata/a.json`),
    { code: "repository-footprint-ls-tree-invalid" },
  );
});

test("count-objects parser converts KiB fields and fails closed on drift", () => {
  const parsed = parseCountObjects([
    "count: 2",
    "size: 3",
    "in-pack: 10",
    "packs: 1",
    "size-pack: 5",
    "prune-packable: 0",
    "garbage: 1",
    "size-garbage: 2",
    "",
  ].join("\n"));
  assert.equal(parsed.looseObjectBytes, 3 * 1024);
  assert.equal(parsed.packBytes, 5 * 1024);
  assert.equal(parsed.totalObjectStoreBytes, 10 * 1024);
  assert.throws(
    () => parseCountObjects("future-field: 1\n"),
    { code: "repository-footprint-count-objects-invalid" },
  );
  assert.throws(
    () => parseCountObjects("count: NaN\n"),
    { code: "repository-footprint-count-objects-invalid" },
  );
});

test("top-N blob ordering is stable across equal sizes and duplicate paths", () => {
  const entries = [
    blob("z/duplicate.bin", OIDS.c, 30),
    blob("a/second.bin", OIDS.b, 50),
    blob("a/first.bin", OIDS.a, 50),
    blob("a/duplicate.bin", OIDS.c, 30),
  ];
  const ranked = buildTopBlobs(entries, 3);
  assert.deepEqual(ranked.map((entry) => entry.oid), [OIDS.a, OIDS.b, OIDS.c]);
  assert.deepEqual(ranked[2].paths, ["a/duplicate.bin", "z/duplicate.bin"]);
  assert.equal(ranked[2].pathCount, 2);
});

test("top-N path totals use a fixed depth and lexical tie-break", () => {
  const entries = [
    blob("z/group/a.bin", OIDS.a, 20),
    blob("z/group/b.bin", OIDS.b, 30),
    blob("a/group/a.bin", OIDS.c, 25),
    blob("a/group/b.bin", OIDS.d, 25),
    blob("m/group/a.bin", OIDS.e, 40),
  ];
  assert.deepEqual(buildTopPathTotals(entries, 3, 2), [
    { path: "a/group", totalBytes: 50, trackedFileCount: 2 },
    { path: "z/group", totalBytes: 50, trackedFileCount: 2 },
    { path: "m/group", totalBytes: 40, trackedFileCount: 1 },
  ]);
});

test("base comparison classifies grandfathered, managed, waived, and unmanaged blobs", () => {
  const baselineEntries = [blob("old/grandfathered.bin", OIDS.a, 120)];
  const baseEntries = [blob("new/unmanaged.bin", OIDS.b, 20)];
  const currentEntries = [
    blob("new/unmanaged.bin", OIDS.c, 180),
    blob("new/managed.bin", OIDS.d, 170),
    blob("new/waived.bin", OIDS.e, 160),
    blob("old/grandfathered.bin", OIDS.a, 120),
    blob("small.bin", OIDS.f, 99),
  ];
  const changes = compareLargeBlobs({
    currentEntries,
    baseEntries,
    baselineEntries,
    managedPaths: new Set(["new/managed.bin"]),
    waivers: [{
      id: "waiver-1",
      path: "new/waived.bin",
      blobOid: OIDS.e,
      maxBytes: 200,
      expiresOn: "2026-12-31",
      reason: "fixture",
    }],
    thresholdBytes: 100,
    asOfDate: "2026-08-26",
  });
  assert.deepEqual(
    Object.fromEntries(changes.map((entry) => [entry.path, [entry.changeType, entry.managementClass]])),
    {
      "new/unmanaged.bin": ["replaced", "new-unmanaged-large-blob"],
      "new/managed.bin": ["added", "managed-manifest"],
      "new/waived.bin": ["added", "waived-unmanaged"],
      "old/grandfathered.bin": ["added", "existing-grandfathered"],
    },
  );
});

test("expired or oversized waivers fail closed to unmanaged classification", () => {
  const waivers = [{
    id: "expired",
    path: "asset.bin",
    blobOid: OIDS.b,
    maxBytes: 100,
    expiresOn: "2026-01-01",
    reason: "fixture",
  }];
  const changes = compareLargeBlobs({
    currentEntries: [blob("asset.bin", OIDS.b, 101)],
    baseEntries: [],
    baselineEntries: [],
    waivers,
    thresholdBytes: 100,
    asOfDate: "2026-08-26",
  });
  assert.equal(changes[0].managementClass, "new-unmanaged-large-blob");
  assert.equal(changes[0].waiverId, null);
});

test("manifest validator rejects unknown fields, versions, paths, and waiver dates", () => {
  assert.equal(validateManifest(manifestFixture()).schemaVersion, 1);
  assert.throws(
    () => validateManifest({ ...manifestFixture(), surprise: true }),
    { code: "repository-footprint-manifest-unknown-field" },
  );
  assert.throws(
    () => validateManifest(manifestFixture({ schemaVersion: 2 })),
    { code: "repository-footprint-manifest-version" },
  );
  assert.throws(
    () => validateManifest(manifestFixture({
      waivers: [{
        id: "bad-date",
        path: "../asset.bin",
        blobOid: OIDS.b,
        maxBytes: 100,
        expiresOn: "2026-02-31",
        reason: "fixture",
      }],
    })),
    { code: "repository-footprint-manifest-invalid" },
  );
  const nestedUnknown = manifestFixture();
  nestedUnknown.policy.extra = true;
  assert.throws(
    () => validateManifest(nestedUnknown),
    { code: "repository-footprint-manifest-unknown-field" },
  );
});

test("managed checksum and source evidence bind the actual output", () => {
  const targetBuffer = Buffer.from("managed payload");
  const sha256 = createHash("sha256").update(targetBuffer).digest("hex");
  assert.equal(validateManagedEvidence({
    asset: {
      path: "data/managed.bin",
      managementKind: "checksum-manifest",
      evidencePointer: "/outputs/managed.bin",
    },
    manifestDocument: {
      outputs: { "managed.bin": { size_bytes: targetBuffer.length, sha256 } },
    },
    targetBytes: targetBuffer.length,
    targetBuffer,
  }), true);
  assert.equal(validateManagedEvidence({
    asset: {
      path: "data/source-managed.bin",
      managementKind: "source-manifest",
      evidencePointer: "/outputs/source-managed.bin",
    },
    manifestDocument: {
      outputs: {
        "source-managed.bin": {
          path: "data/source-managed.bin",
          size_bytes: targetBuffer.length,
          sha256,
          source: { upstream_sha256: "1".repeat(64) },
        },
      },
    },
    targetBytes: targetBuffer.length,
    targetBuffer,
  }), true);
  assert.throws(() => validateManagedEvidence({
    asset: {
      path: "data/source-managed.bin",
      managementKind: "source-manifest",
      evidencePointer: "/source_signature",
    },
    manifestDocument: {
      paths: { full: "data/source-managed.bin" },
      source_signature: { upstream: { sha256 } },
    },
    targetBytes: targetBuffer.length,
    targetBuffer,
  }), { code: "repository-footprint-managed-evidence-invalid" });
  assert.throws(() => validateManagedEvidence({
    asset: {
      path: "data/source-managed.bin",
      managementKind: "source-manifest",
      evidencePointer: "/outputs/source-managed.bin",
    },
    manifestDocument: {
      outputs: {
        "source-managed.bin": {
          path: "data/source-managed.bin",
          size_bytes: targetBuffer.length,
          sha256: createHash("sha256").update(Buffer.from("different payload")).digest("hex"),
        },
      },
    },
    targetBytes: targetBuffer.length,
    targetBuffer,
  }), { code: "repository-footprint-managed-evidence-invalid" });
  assert.throws(() => validateManagedEvidence({
    asset: {
      path: "data/managed.bin",
      managementKind: "checksum-manifest",
      evidencePointer: "/outputs/managed.bin",
    },
    manifestDocument: {
      outputs: { "managed.bin": { size_bytes: targetBuffer.length, sha256: "0".repeat(64) } },
    },
    targetBytes: targetBuffer.length,
    targetBuffer,
  }), { code: "repository-footprint-managed-evidence-invalid" });
});

test("report-only warns while gate mode fails the same policy finding", () => {
  const currentEntries = [blob("new.bin", OIDS.b, 150)];
  const common = {
    targetCommit: OIDS.b,
    targetCommitDate: "2026-08-26T00:00:00Z",
    asOfDate: "2026-08-26",
    baseCommit: OIDS.c,
    baselineCommit: OIDS.a,
    currentEntries,
    baseEntries: [],
    baselineEntries: [],
    objectDatabase: {
      looseObjectCount: 0,
      looseObjectBytes: 0,
      packedObjectCount: 0,
      packCount: 0,
      packBytes: 0,
      prunePackableObjectCount: 0,
      garbageObjectCount: 0,
      garbageBytes: 0,
      totalObjectStoreBytes: 0,
      scope: "shared-git-object-database",
      measurement: "git-count-objects-kib-converted-to-bytes",
    },
    managedPaths: new Set(),
  };
  const reportOnly = validateReport(buildReport({ ...common, manifest: manifestFixture() }));
  const gateManifest = manifestFixture({
    policy: { ...manifestFixture().policy, mode: "gate" },
  });
  const gate = buildReport({ ...common, manifest: gateManifest });
  assert.equal(reportOnly.policy.outcome, "warning");
  assert.equal(gate.policy.outcome, "fail");
  assert.equal(reportOnly.policy.findings.length, 1);
});

test("waiver expiry uses the UTC evaluation date independently of an old target commit", () => {
  const currentEntries = [blob("asset.bin", OIDS.b, 150)];
  const report = validateReport(buildReport({
    targetCommit: OIDS.b,
    targetCommitDate: "2020-01-01T00:00:00Z",
    asOfDate: "2026-08-26",
    baseCommit: OIDS.c,
    baselineCommit: OIDS.a,
    currentEntries,
    baseEntries: [],
    baselineEntries: [],
    objectDatabase: {
      looseObjectCount: 0,
      looseObjectBytes: 0,
      packedObjectCount: 0,
      packCount: 0,
      packBytes: 0,
      prunePackableObjectCount: 0,
      garbageObjectCount: 0,
      garbageBytes: 0,
      totalObjectStoreBytes: 0,
      scope: "shared-git-object-database",
      measurement: "git-count-objects-kib-converted-to-bytes",
    },
    manifest: manifestFixture({
      waivers: [{
        id: "expired-after-old-head",
        path: "asset.bin",
        blobOid: OIDS.b,
        maxBytes: 200,
        expiresOn: "2021-01-01",
        reason: "fixture",
      }],
    }),
    managedPaths: new Set(),
  }));
  assert.equal(report.target.commitDate, "2020-01-01T00:00:00Z");
  assert.equal(report.policy.evaluatedAt, "2026-08-26");
  assert.equal(report.policy.largeAssetInventory[0].managementClass, "new-unmanaged-large-blob");
  assert.equal(report.policy.findings.length, 1);
});

test("runtime report validation rejects missing, additional, and invalid enum fields", () => {
  const valid = validateReport(buildReport({
    targetCommit: OIDS.b,
    targetCommitDate: "2026-08-26T00:00:00Z",
    asOfDate: "2026-08-26",
    baseCommit: OIDS.c,
    baselineCommit: OIDS.a,
    currentEntries: [blob("new.bin", OIDS.b, 150)],
    baseEntries: [],
    baselineEntries: [],
    objectDatabase: {
      looseObjectCount: 0,
      looseObjectBytes: 0,
      packedObjectCount: 0,
      packCount: 0,
      packBytes: 0,
      prunePackableObjectCount: 0,
      garbageObjectCount: 0,
      garbageBytes: 0,
      totalObjectStoreBytes: 0,
      scope: "shared-git-object-database",
      measurement: "git-count-objects-kib-converted-to-bytes",
    },
    manifest: manifestFixture(),
    managedPaths: new Set(),
  }));
  const missing = structuredClone(valid);
  delete missing.target.commit;
  assert.throws(() => validateReport(missing), { code: "repository-footprint-report-invalid" });
  const additional = structuredClone(valid);
  additional.policy.extra = true;
  assert.throws(() => validateReport(additional), { code: "repository-footprint-report-invalid" });
  const invalidEnum = structuredClone(valid);
  invalidEnum.policy.outcome = "unknown";
  assert.throws(() => validateReport(invalidEnum), { code: "repository-footprint-report-invalid" });
});

test("unresolved base revisions fail closed", () => {
  const runner = () => ({ status: 1, stdout: "", stderr: "unknown revision" });
  assert.throws(
    () => resolveCommit("missing-base", runner),
    { code: "repository-footprint-git-failed" },
  );
});

test("versioned baseline and report schemas are strict JSON contracts", () => {
  const manifestSchema = JSON.parse(fs.readFileSync(
    path.join(FOOTPRINT_DIR, "repository_footprint_manifest.schema.json"),
    "utf8",
  ));
  const reportSchema = JSON.parse(fs.readFileSync(
    path.join(FOOTPRINT_DIR, "repository_footprint_report.schema.json"),
    "utf8",
  ));
  const baseline = JSON.parse(fs.readFileSync(path.join(FOOTPRINT_DIR, "baseline.v1.json"), "utf8"));
  assert.equal(manifestSchema.properties.schemaVersion.const, 1);
  assert.equal(reportSchema.properties.schemaVersion.const, 1);
  assert.equal(manifestSchema.additionalProperties, false);
  assert.equal(reportSchema.additionalProperties, false);
  assert.equal(baseline.policy.mode, "report-only");
  assert.equal(validateManifest(baseline), baseline);
});

test("canonical SF-ATS route owns every footprint control-plane path", () => {
  const route = VERIFICATION_DOMAINS.find((entry) => entry.id === "infra:repository-footprint-report");
  assert.ok(route);
  assert.equal(route.commandRef, "node --test tests/repository_footprint_behavior.test.mjs");
  assert.equal(route.verifyCoreDefaultGroup, undefined);
  assert.equal(route.routeRegistry, true);
  assert.deepEqual(route.sourceRefs, [
    ".github/workflows/repository-footprint-report.yml",
    "tests/repository_footprint_behavior.test.mjs",
    "tools/repository_footprint",
    "tools/repository_footprint.mjs",
  ]);
});

test("standalone workflow keeps footprint policy report-only and publishes runtime artifacts", () => {
  const workflow = fs.readFileSync(
    path.join(REPO_ROOT, ".github", "workflows", "repository-footprint-report.yml"),
    "utf8",
  );
  assert.match(workflow, /^name: Repository Footprint Report$/m);
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.match(workflow, /^  schedule:$/m);
  assert.doesNotMatch(workflow, /^  (?:pull_request|push):$/m);
  assert.match(workflow, /^  report-only:$/m);
  assert.match(workflow, /node tools\/repository_footprint\.mjs/);
  assert.match(workflow, /args=\(--as-of "\$\(date -u \+%F\)"\)/);
  assert.match(workflow, /\.runtime\/reports\/generated\/repository-footprint\.\*/);
  assert.match(workflow, /uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.doesNotMatch(workflow, /verify:(?:core|nightly|release)|deploy-pages/);
});
