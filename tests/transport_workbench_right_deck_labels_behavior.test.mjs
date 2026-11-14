import { TestElement, createTestDocument, withTestDocument } from "./helpers/transport_right_deck_document.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import {
  createTransportWorkbenchRightDeckOwner,
} from "../js/ui/transport_workbench/transport_workbench_right_deck_owner.js";

function walk(node) {
  return [node, ...(node.children || []).flatMap(walk)];
}

function findByTag(node, tagName) {
  return walk(node).find((candidate) => candidate.tagName === tagName);
}

function findAllByTag(node, tagName) {
  return walk(node).filter((candidate) => candidate.tagName === tagName);
}

function findByText(node, pattern) {
  return walk(node).find((candidate) => pattern.test(candidate.textContent || ""));
}

function findAllByClass(node, className) {
  return walk(node).filter((candidate) => candidate.classList?.contains(className));
}

function textOf(node) {
  return [node.textContent, ...(node.children || []).map(textOf)].join(" ");
}

for (const familyId of ["airport", "port"]) {
  test(`${familyId} point fields retain visible associated labels and edit payloads`, () => withTestDocument(() => {
    const mount = new TestElement();
    const events = [];
    const owner = createTransportWorkbenchRightDeckOwner({
      getPreviewSnapshot: () => ({ selected: { id: "source-1", name: "Selected point", lon: 139.77, lat: 35.68 }, dataRows: [] }),
      addEditOverlayPoint: (...args) => events.push(["add", ...args]),
      updateEditOverlayPoint: (...args) => events.push(["update", ...args]),
    });
    owner.renderTabSections({ id: familyId }, {}, "data", mount);
    const form = findAllByClass(mount, "transport-workbench-edit-overlay-form")[0];
    const inputs = findAllByTag(form, "input");
    const labels = findAllByTag(form, "label");
    assert.equal(labels.length, 3);
    assert.deepEqual(labels.map((label) => label.textContent), ["Name", "Longitude", "Latitude"]);
    assert.equal(new Set(inputs.map((input) => input.id)).size, 3);
    inputs.forEach((input, index) => {
      assert.ok(input.id);
      assert.equal(labels[index].htmlFor, input.id);
      assert.equal(input.parentNode, form);
      assert.equal(labels[index].parentNode, form);
    });
    assert.deepEqual(inputs.map((input) => input.value), ["Selected point", "139.77", "35.68"]);
    inputs[0].value = "Renamed point";
    inputs[1].value = "120.5";
    inputs[2].value = "30.25";
    findAllByTag(form, "button").find((button) => button.textContent === "Add point").dispatch("click");
    findAllByTag(form, "button").find((button) => button.textContent === "Save selected").dispatch("click");
    const payload = { name: "Renamed point", lon: "120.5", lat: "30.25" };
    assert.deepEqual(events, [["add", familyId, payload], ["update", familyId, "source-1", payload]]);
    assert.deepEqual(labels.map((label) => label.textContent), ["Name", "Longitude", "Latitude"]);
  }));
}
