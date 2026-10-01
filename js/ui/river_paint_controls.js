import { getRiverPaintRuntime } from '../core/river_paint/runtime.js';
import { loadRiverPaintPilot } from '../core/river_paint/pilot_loader.js';
import { RIVER_PAINT_PILOT } from '../core/river_paint/pilot_manifest.js';

// Optional pilot controls. Loading is cancellable and never changes the current
// scenario or turns an unavailable half-cell click into an entire-parent edit.
export function createRiverPaintControls({ state, button, statusNode = null,
  rebuildGeometry, render = () => {}, markDirty = () => {}, announce = () => {},
  loadPack = loadRiverPaintPilot, runtime = getRiverPaintRuntime(state),
} = {}) {
  let disposed = false;
  const zh = () => state.currentLanguage === 'zh';
  function sync() {
    if (!button || disposed) return;
    const info = runtime.diagnostics();
    const supported = state.activeScenarioId === RIVER_PAINT_PILOT.sceneId;
    const enabled = supported && !!state.riverPaint?.editMode;
    button.disabled = !supported || !!state.startupReadonly;
    button.classList.toggle('is-active', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-busy', String(info.pending));
    const label = info.pending ? (zh() ? '取消加载' : 'Cancel loading') : (zh() ? '沿河填色' : 'River cells');
    button.textContent = label;
    const description = !supported
      ? (zh() ? '试点仅支持 Modern World。' : 'Pilot available in Modern World only.')
      : info.error ? (zh() ? `沿河分区未就绪：${info.error}` : `River partitions unavailable: ${info.error}`)
      : (zh() ? '局部试点：巴黎、鲁昂、Stendal、Jerichower Land、Dubna、Yaroslavl。关闭工具不会清除已填颜色。'
        : 'Local pilot: Paris, Rouen, Stendal, Jerichower Land, Dubna and Yaroslavl. Turning off the tool preserves paint.');
    button.title = description;
    button.setAttribute('aria-label', `${label}. ${description}`);
    if (statusNode) statusNode.textContent = description;
  }
  async function toggle() {
    if (!button || button.disabled || disposed) return;
    if (state.riverPaint?.editMode) {
      runtime.setMode(false); markDirty('river-paint-mode'); sync(); render(); return;
    }
    const promise = runtime.enable(loadPack);
    sync();
    try {
      const result = await promise;
      if (disposed || !result.ready) return;
      if (result.geometryChanged) {
        // Rebuild the existing display and interaction indexes once. Source
        // topology and administrative/scenario membership remain untouched.
        await rebuildGeometry();
      }
      markDirty('river-paint-enable');
      render();
      announce(zh() ? '沿河试点已启用。将地图移至试点地块，分别点击河流两侧填色。'
        : 'River pilot enabled. Navigate to a pilot district and click each side to paint.');
    } catch (failure) {
      if (!disposed) announce(zh() ? `无法启用沿河分区：${failure.message}` : `Cannot enable river partitions: ${failure.message}`);
    } finally { sync(); }
  }
  if (button) button.addEventListener('click', toggle);
  sync();
  return Object.freeze({ sync, toggle,
    dispose() { disposed = true; button?.removeEventListener('click', toggle); runtime.cancel(); },
  });
}
