import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = process.cwd();
const TEST_ROOT = path.join(REPO_ROOT, "tests", "e2e");
const DEFAULT_GRAPH_OUT = path.join(TEST_ROOT, "test-import-graph.json");
const DEFAULT_SUMMARY_JSON_OUT = path.join(REPO_ROOT, ".runtime", "reports", "generated", "test-import-graph-summary.json");
const DEFAULT_SUMMARY_MD_OUT = path.join(REPO_ROOT, ".runtime", "reports", "generated", "test-import-graph-summary.md");
const JS_EXTENSIONS = [".js", ".mjs"];

function toRepoPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function parseArgs(argv) {
  const args = {
    graphOut: DEFAULT_GRAPH_OUT,
    summaryJsonOut: DEFAULT_SUMMARY_JSON_OUT,
    summaryMdOut: DEFAULT_SUMMARY_MD_OUT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--graph-out") args.graphOut = argv[++index];
    else if (token === "--summary-json-out") args.summaryJsonOut = argv[++index];
    else if (token === "--summary-md-out") args.summaryMdOut = argv[++index];
  }
  return args;
}

function walkFiles(rootDir) {
  const results = [];
  const queue = [rootDir];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(nextPath);
        continue;
      }
      if (entry.isFile() && JS_EXTENSIONS.includes(path.extname(entry.name))) {
        results.push(nextPath);
      }
    }
  }
  return results.sort();
}

function walkSpecFiles(rootDir) {
  return walkFiles(rootDir).filter((filePath) => filePath.endsWith(".spec.js"));
}

function fileExists(repoPath) {
  return fs.existsSync(path.join(REPO_ROOT, repoPath));
}

function resolveRelativeFile(baseRepoPath, specifier) {
  const resolvedBase = toRepoPath(path.posix.normalize(path.posix.join(path.posix.dirname(baseRepoPath), specifier)));
  const candidates = [];
  if (/\.[A-Za-z0-9]+$/.test(resolvedBase)) {
    candidates.push(resolvedBase);
  } else {
    for (const extension of JS_EXTENSIONS) {
      candidates.push(`${resolvedBase}${extension}`);
    }
    for (const extension of JS_EXTENSIONS) {
      candidates.push(path.posix.join(resolvedBase, `index${extension}`));
    }
  }
  return candidates.find((candidate) => fileExists(candidate)) || null;
}

function resolveRepoSpecifier(baseRepoPath, specifier) {
  const value = String(specifier || "").trim();
  if (!value) return null;
  if (value.startsWith(".")) {
    const relativeResolved = resolveRelativeFile(baseRepoPath, value);
    if (relativeResolved) {
      return relativeResolved;
    }
    if (value.startsWith("./js/") || value.startsWith("./data/")) {
      const repoRootResolved = toRepoPath(value.slice(2));
      return fileExists(repoRootResolved) ? repoRootResolved : null;
    }
    return null;
  }
  if (value.startsWith("/")) {
    const normalized = toRepoPath(value.slice(1));
    return fileExists(normalized) ? normalized : null;
  }
  return null;
}

function extractSpecifiers(content) {
  const specifiers = new Set();
  const expressions = [
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /from\s*["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
    /new URL\(\s*["']([^"']+)["']/g,
  ];
  for (const expression of expressions) {
    for (const match of content.matchAll(expression)) {
      specifiers.add(String(match[1] || "").trim());
    }
  }
  return [...specifiers];
}

function buildGraph(args) {
  const sourceFiles = walkFiles(TEST_ROOT);
  const sourceRepoPaths = sourceFiles.map((filePath) => toRepoPath(path.relative(REPO_ROOT, filePath)));
  const sourceSet = new Set(sourceRepoPaths);
  const adjacency = {};
  const unresolved = [];

  for (const repoPath of sourceRepoPaths) {
    const absolutePath = path.join(REPO_ROOT, repoPath);
    const content = fs.readFileSync(absolutePath, "utf8");
    const dependencies = [];
    for (const specifier of extractSpecifiers(content)) {
      const resolved = resolveRepoSpecifier(repoPath, specifier);
      if (resolved) {
        dependencies.push(resolved);
      } else if (specifier.startsWith(".") || specifier.startsWith("/")) {
        unresolved.push({ from: repoPath, specifier });
      }
    }
    adjacency[repoPath] = [...new Set(dependencies)].sort();
  }

  const specs = {};
  const reverseIndex = new Map();
  for (const specPath of sourceRepoPaths.filter((repoPath) => repoPath.endsWith(".spec.js"))) {
    const directDependencies = adjacency[specPath] || [];
    const visited = new Set();
    const queue = [...directDependencies];
    while (queue.length) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      for (const dependency of adjacency[current] || []) {
        if (!visited.has(dependency)) {
          queue.push(dependency);
        }
      }
    }
    const transitiveDependencies = [...visited].sort();
    specs[specPath] = {
      directDependencies,
      transitiveDependencies,
      repoImpact: transitiveDependencies.filter((dependency) => !dependency.startsWith("tests/e2e/")),
    };
    for (const dependency of new Set([specPath, ...transitiveDependencies])) {
      // Each spec visits a dependency once; order owners after all visits.
      const bucket = reverseIndex.get(dependency) || [];
      bucket.push(specPath);
      reverseIndex.set(dependency, bucket);
    }
  }

  const reverseIndexObject = Object.fromEntries(
    [...reverseIndex.entries()]
      .filter(([dependency]) => dependency !== "")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([dependency, owners]) => [dependency, owners.sort()])
  );
  const summary = {
    specCount: Object.keys(specs).length,
    nodeCount: sourceRepoPaths.length,
    reverseIndexKeyCount: Object.keys(reverseIndexObject).length,
    topSharedDependencies: Object.entries(reverseIndexObject)
      .filter(([dependency]) => dependency !== "")
      .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
      .slice(0, 20)
      .map(([dependency, owners]) => ({ dependency, specCount: owners.length })),
  };

  const graph = {
    schemaVersion: 1,
    graphMode: "artifact-only",
    summary,
    specs,
    reverseIndex: reverseIndexObject,
    unresolved,
  };

  fs.mkdirSync(path.dirname(args.graphOut), { recursive: true });
  fs.writeFileSync(args.graphOut, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(args.summaryJsonOut), { recursive: true });
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(args.summaryJsonOut, `${JSON.stringify({ generatedAt, summary, unresolvedCount: unresolved.length }, null, 2)}\n`, "utf8");
  const markdown = [
    "# test-import-graph-summary",
    "",
    `- generatedAt: ${generatedAt}`,
    `- specCount: ${summary.specCount}`,
    `- nodeCount: ${summary.nodeCount}`,
    `- reverseIndexKeyCount: ${summary.reverseIndexKeyCount}`,
    `- unresolvedCount: ${unresolved.length}`,
    "",
    "## Top shared dependencies",
    ...(summary.topSharedDependencies.length
      ? summary.topSharedDependencies.map((entry) => `- ${entry.dependency}: ${entry.specCount} specs`)
      : ["- none"]),
  ].join("\n");
  fs.mkdirSync(path.dirname(args.summaryMdOut), { recursive: true });
  fs.writeFileSync(args.summaryMdOut, `${markdown}\n`, "utf8");
  console.log(`Wrote import graph for ${summary.specCount} specs.`);
}

buildGraph(parseArgs(process.argv.slice(2)));
