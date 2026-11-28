import assert from "node:assert/strict";
import test from "node:test";
import { applyCountryColor } from "../js/core/country_color_commands.js";
import { replaceFeatureColor } from "../js/core/replace_color_command.js";
import { clearHistory, redoHistory, undoHistory } from "../js/core/history_manager.js";
import { state } from "../js/core/state.js";
import { makeFixture } from "./helpers/river_paint_fixture.mjs";

const oldColor = "#ff0000";
const newColor = "#223344";

async function setup(t) {
  const fixture = await makeFixture();
  const [matching, retained] = fixture.cells.map(cell => cell.id);
  const patch = {
    landData: fixture.state.landData,
    countryPalette: { FR: oldColor },
    sovereignBaseColors: { FR: oldColor },
    visualOverrides: { P: "#F00", distant: oldColor, unrelated: "#123456" },
    riverPaint: { ...fixture.state.riverPaint, overrides: { [matching]: oldColor, [retained]: "#abcdef" } },
    legendLabels: { [oldColor]: "France" },
    legendColorOrder: [oldColor],
  };
  const previous = Object.fromEntries(Object.keys(patch).map(key => [key, state[key]]));
  Object.assign(state, patch);
  clearHistory();
  t.after(() => { clearHistory(); Object.assign(state, previous); });
  return { matching, retained };
}

test("inspector confirmation replaces base, paint, river cells and legend in one reversible edit", async t => {
  const { matching, retained } = await setup(t);
  let prompts = 0;
  await applyCountryColor("FR", newColor, async ({ message }) => {
    prompts++;
    assert.ok(message.includes("2"));
    assert.equal(state.sovereignBaseColors.FR, oldColor);
    return true;
  });
  assert.equal(prompts, 1);
  function check(color, paint) {
    assert.equal(state.sovereignBaseColors.FR, color);
    assert.equal(state.countryPalette.FR, color);
    assert.deepEqual(state.visualOverrides, { P: paint, distant: color, unrelated: "#123456" });
    assert.deepEqual(state.riverPaint.overrides, { [matching]: color, [retained]: "#abcdef" });
    assert.deepEqual(state.legendLabels, { [color]: "France" });
    assert.deepEqual(state.legendColorOrder, [color]);
  }
  assert.deepEqual(state.historyPast.map(entry => entry.kind), ["replace-color"]);
  check(newColor, newColor);
  assert.equal(undoHistory(), true);
  check(oldColor, "#F00");
  assert.equal(redoHistory(), true);
  check(newColor, newColor);
});

test("standalone replacement rewrites river-only matches and preserves an existing destination label", async t => {
  const { matching, retained } = await setup(t);
  delete state.visualOverrides.P;
  delete state.visualOverrides.distant;
  state.legendLabels[newColor] = "Destination";
  replaceFeatureColor("#F00", newColor);
  assert.deepEqual(state.historyPast.map(entry => entry.kind), ["replace-color"]);
  assert.deepEqual(state.riverPaint.overrides, { [matching]: newColor, [retained]: "#abcdef" });
  assert.deepEqual(state.legendLabels, { [newColor]: "Destination" });
  assert.equal(state.sovereignBaseColors.FR, oldColor);
  assert.equal(undoHistory(), true);
  assert.deepEqual(state.legendLabels, { [oldColor]: "France", [newColor]: "Destination" });
  assert.equal(state.riverPaint.overrides[matching], oldColor);
});
