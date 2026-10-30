const installations = new WeakMap();

export function getVisibleViewportRect(win = globalThis) {
  const vv = win.visualViewport;
  const top = vv ? vv.offsetTop : 0;
  const left = vv ? vv.offsetLeft : 0;
  const width = vv ? vv.width : Math.max(win.document?.documentElement?.clientWidth || 0, win.innerWidth || 0);
  const height = vv ? vv.height : Math.max(win.document?.documentElement?.clientHeight || 0, win.innerHeight || 0);
  return { top, left, width, height, bottom: top + height, right: left + width };
}

export function installVisualViewportCssVars({ win = globalThis, root = win.document?.documentElement } = {}) {
  if (installations.has(root)) return installations.get(root);
  const vv = win.visualViewport;
  let disposed = false;
  let scheduled = false;
  const update = () => {
    scheduled = false;
    if (disposed) return;
    const rect = getVisibleViewportRect(win);
    root.style.setProperty("--visual-viewport-top", `${rect.top}px`);
    root.style.setProperty("--visual-viewport-height", `${rect.height}px`);
  };
  const schedule = () => {
    if (scheduled) return;
    if (win.requestAnimationFrame) {
      scheduled = true;
      win.requestAnimationFrame(update);
    } else update();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    vv?.removeEventListener("resize", schedule);
    vv?.removeEventListener("scroll", schedule);
    installations.delete(root);
  };
  installations.set(root, dispose);
  update();
  vv?.addEventListener("resize", schedule);
  vv?.addEventListener("scroll", schedule);
  return dispose;
}
