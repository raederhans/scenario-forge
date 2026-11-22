import assert from "node:assert/strict";
import test from "node:test";
import { createMapInteractionEventBindingOwner } from "../js/core/renderer/map_interaction_event_binding_owner.js";
import { createBrushInteractionSessionOwner } from "../js/core/renderer/brush_interaction_session_owner.js";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";
import { createRiverPaintEditorOwner } from "../js/core/river_paint/editor_owner.js";
import { createMapHoverInteractionOwner } from "../js/core/map_renderer/map_hover_interaction_owner.js";
import { runFrameTasks } from "../js/core/frame_scheduler.js";
import { captureCells, makeFixture } from "./helpers/river_paint_fixture.mjs";

const noop = () => {};

test("one mouse pointermove applies the active intensity brush once", () => {
  const moves = [];
  let brushDrag = false;
  const listeners = new Map();
  const intensityMove = event => { moves.push(event); return true; };
  const brush = createBrushInteractionSessionOwner({}, {
    getBrushSession: () => null,
    handlePhysicalIntensityPointerMove: intensityMove,
  });
  const brushMoves = [];
  const owner = createMapInteractionEventBindingOwner({
    getters: { getInteractionRect: () => ({ on: (name, fn) => listeners.set(name, fn) }),
      getWindow: () => ({ addEventListener: noop }), hasMouseBrushDrag: () => brushDrag },
    handlers: { ...brush, handleMouseMove: noop, handleMouseLeave: noop, mapClick: noop, mapDoubleClick: noop,
      handleBrushPointerMove(event) { brushMoves.push(event); brush.handleBrushPointerMove(event); },
      handlePhysicalIntensityPointerMove: intensityMove, handlePhysicalIntensityPointerEnd: noop,
      handleResize: noop, handleSidebarLayoutStart: noop },
  });
  owner.bindEvents();
  const event = { pointerType: "mouse", pointerId: 1, buttons: 1 };
  const move = () => {
    for (const [name, listener] of listeners) {
      if (name.split(".")[0] === "pointermove") listener(event);
    }
  };
  move();
  assert.deepEqual(moves, [event]);
  brushDrag = true;
  move();
  assert.deepEqual(brushMoves, [event]);
  assert.deepEqual(moves, [event, event]);
});

test("only-unpainted protects a parent with a painted river cell from brush and quick fill", async () => {
  const { state, parent, cells } = await makeFixture();
  state.onlyUnpainted = true;
  state.riverPaint.editMode = false;
  state.riverPaint.overrides[cells[0].id] = "#ff0000";
  const policy = createFillTargetPolicy(state, {
    getColorAdjacency: () => null, getFeaturePaintColor: () => "#cccccc",
    getVisibleFeatureIds: () => ["P", "N"], shouldExcludePoliticalInteractionFeature: () => false,
  });
  assert.deepEqual(policy.unprotectedIds(["P", "N"]), ["N"]);
  const plan = policy.buildDoubleClickBatchPlan(parent, "P", "color");
  assert.deepEqual(plan.targetIds, ["N"]);
  assert.equal(plan.skippedCount, 1);
});

test("river clicks and strokes skip painted cells, while fresh cells and erasing remain editable", async () => {
  const { state, pack, hit, cells } = await makeFixture();
  state.onlyUnpainted = true;
  const history = [];
  const editor = createRiverPaintEditorOwner({ state, captureHistoryState: captureCells(state),
    commitHistoryEntry: entry => history.push(entry), refreshParents: noop, markDirty: noop, addRecentColor: noop });
  const bank = i => ({ ...hit, riverPackId: pack.packId, riverCellId: cells[i].id });
  state.riverPaint.overrides[cells[0].id] = "#ff0000";
  assert.equal(editor.handleClick(bank(0)), true);
  assert.equal(state.riverPaint.overrides[cells[0].id], "#ff0000");
  const session = { before: {} };
  assert.deepEqual(editor.handleBrush(bank(0), session), { consumed: true, changed: false });
  assert.equal(history.length, 0);
  assert.equal(editor.handleBrush(bank(1), session).changed, true);
  assert.equal(state.riverPaint.overrides[cells[1].id], state.selectedColor);
  state.currentTool = "eraser";
  editor.handleClick(bank(0));
  assert.equal(Object.hasOwn(state.riverPaint.overrides, cells[0].id), false);
  assert.equal(history.length, 1);
});

test("color hover reuses connected counts and defers viewport scans until idle", () => {
  const ids = ["a", "b", "c"];
  const state = { landData: {}, landIndex: new Map(ids.map(id => [id, { id }])),
    currentTool: "fill", interactionGranularity: "subdivision", batchFillScope: "color", renderPhase: "idle",
    colorRevision: 0, onlyUnpainted: true, visualOverrides: { b: "#ffffff" } };
  let reads = 0, scans = 0, adjacency = { ids, graph: [[1], [0, 2], [1]] };
  const policy = createFillTargetPolicy(state, {
    getColorAdjacency: () => adjacency, getFeaturePaintColor: () => { reads++; return "#ffffff"; },
    getVisibleFeatureIds: () => { scans++; return ids; }, shouldExcludePoliticalInteractionFeature: () => false,
  });
  const owner = createMapHoverInteractionOwner({ state,
    surfaceHost: { getTooltip: () => ({ style: {} }), getInteractionRect: () => null },
    getters: { nowMs: () => 1, getGlobal: () => ({ requestAnimationFrame: noop, cancelAnimationFrame: noop }),
      getHitFromEvent: event => ({ targetType: "land", id: event.id }), getFeatureForHit: hit => state.landIndex.get(hit.id),
      getTooltipTextForFeature: feature => feature.id, getFillTargetPolicy: () => policy, getHoveredFacilityEntryFromEvent: noop,
      isFacilityDetailsSurfaceActive: noop, getHoveredCityTooltipEntry: noop, getOverlayProjectionSignature: noop,
      getSelectedFacilityEntry: noop, shouldBlockUnderlyingSelectionForFacility: noop },
    effects: { updateDevHoverHit: noop, renderHoverOverlay: noop, recordInteractionDurationMetric: noop,
      hidePhysicalIntensityBrushPreview: noop }, helpers: { getFacilityKey: noop },
  });
  const hover = id => { owner.handleMouseMove({ id }); return state.tooltipPendingState.text; };
  const first = hover("a");
  const componentReads = reads;
  assert.ok(componentReads >= ids.length);
  state.zoomTransform = { k: 2 };
  assert.equal(hover("b"), first.replace(/^a/, "b"));
  assert.equal(reads, componentReads);
  state.visualOverrides = {};
  state.colorRevision++;
  assert.notEqual(hover("a"), first);
  adjacency = null;
  state.topologyRevision = 1;
  hover("a");
  hover("b");
  assert.equal(scans, 0);
  runFrameTasks();
  assert.equal(scans, 1);
  assert.ok(state.tooltipPendingState.text.startsWith("b\n"));
  hover("c");
  runFrameTasks();
  assert.equal(scans, 1);
  state.zoomTransform = { k: 3 };
  hover("c");
  assert.equal(scans, 1);
  owner.handleMapMouseLeave();
  runFrameTasks();
  assert.equal(scans, 1);
  hover("c");
  runFrameTasks();
  assert.equal(scans, 2);
});
