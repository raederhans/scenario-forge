// Merge political geometries that share arcs, keeping arcs shared with neighbors.
// Usage: node tools/merge_political_topology_arcs.mjs <topology.json[.gz]> <groups.json> <output.json>
// groups.json: [{ "id": "...", "member_ids": [...] }]. Groups absent from the
// topology are skipped; partially present groups are an error.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [topologyPath, groupsPath, outputPath] = process.argv.slice(2);
if (!topologyPath || !groupsPath || !outputPath) {
  throw new Error("Usage: node tools/merge_political_topology_arcs.mjs <topology> <groups.json> <output.json>");
}

const context = { exports: {}, module: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "vendor/topojson-client.min.js"), "utf8"), context);
const raw = fs.readFileSync(topologyPath);
const topology = JSON.parse((topologyPath.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));
const rows = new Map(topology.objects.political.geometries.map(row => [String(row.properties?.id ?? row.id), row]));
const groups = JSON.parse(fs.readFileSync(groupsPath, "utf8"));

const merged = {};
for (const group of groups) {
  const present = group.member_ids.filter(id => rows.has(id));
  if (!present.length) continue;
  if (present.length !== group.member_ids.length) {
    throw new Error(`${group.id}: only ${present.length}/${group.member_ids.length} members in ${topologyPath}`);
  }
  merged[group.id] = context.exports.mergeArcs(topology, present.map(id => rows.get(id)));
}
fs.writeFileSync(outputPath, JSON.stringify(merged));
console.log(JSON.stringify({ topology: topologyPath, merged: Object.keys(merged).length }));
