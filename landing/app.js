import { COPY } from "./i18n.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const STORAGE_KEY = "scenario_forge_landing_lang";
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smooth = (t) => t * t * (3 - 2 * t);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lerpRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgbString = (rgb) => `rgb(${rgb.map(Math.round).join(",")})`;
const svgEl = (name, attributes = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};
// Replacing a text node, even with the same text, invalidates layout; skip unchanged writes.
const setText = (node, text) => {
  if (node.textContent !== text) node.textContent = text;
};
const boxesOverlap = (a, b) => a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;
const toBox = (rect, padX, padY) => ({ x: rect.left - padX, y: rect.top - padY, r: rect.right + padX, b: rect.bottom + padY });

/* ---------- Language ---------- */

let language = "en";
try {
  language = localStorage.getItem(STORAGE_KEY) === "zh" ? "zh" : "en";
} catch {
  // Storage can be unavailable; English stays the default.
}
const copy = () => COPY[language];

function applyLanguage(next) {
  language = next;
  const strings = copy();
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = strings[node.dataset.i18n];
  for (const node of document.querySelectorAll("[data-i18n-aria-label]")) node.setAttribute("aria-label", strings[node.dataset.i18nAriaLabel]);
  for (const node of document.querySelectorAll("[data-i18n-alt]")) node.setAttribute("alt", strings[node.dataset.i18nAlt]);
  for (const node of document.querySelectorAll("[data-i18n-list]")) {
    node.replaceChildren(...strings[node.dataset.i18nList].split("|").map((item) => Object.assign(document.createElement("li"), { textContent: item })));
  }
  document.title = strings.metaTitle;
  document.querySelector('meta[name="description"]')?.setAttribute("content", strings.metaDescription);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not persisting the choice is fine.
  }
  document.dispatchEvent(new Event("landing:language"));
}

/* ---------- The map stage ---------- */

const PAINT_COLOURS = ["#c8412d", "#e0a66a", "#d6b978", "#87977a", "#3f6f72", "#5b6f9e", "#8e6aa0", "#e8e0cf"];
const BLANK_RGB = hexToRgb("#8d998f");
const PAPER_RGB = hexToRgb("#ece3cf");
const INK_RGB = hexToRgb("#141c19");
const WORLD_STATE = { blank: null, modern: 3, 1936: 0, 1939: 1, 1962: 2 };
const STYLES = ["game", "atlas", "ink"];
const WORLDS = ["blank", "modern", "1936", "1939", "1962"];
// Width of the recolour sweep line, in viewBox units.
const FRONT_WIDTH = 120;
// Timed effects stay well under the time a reader takes to scroll through a chapter,
// so a change has landed before the next one starts.
const TIMING = { recolour: 800, recolourFromHistory: 700, style: 700, paint: 450, reset: 600, reveal: 1300, settle: 950 };

// Camera per chapter: a pan in viewBox units, never a zoom. A pure translation is
// composited on the GPU; animating scale re-rasterized the whole map every frame.
const CAMERAS = {
  history: { x: 0, y: 0 },
  edit: { x: 150, y: 20 },
  style: { x: 160, y: 0 },
  context: { x: 120, y: 0 },
  worlds: { x: 170, y: -10 },
  outro: { x: 170, y: -10 },
};

function initStage(data) {
  const story = document.querySelector("[data-story]");
  const stage = story.querySelector("[data-stage]");
  const svg = stage.querySelector("[data-map]");
  const lens = stage.querySelector("[data-lens]");
  const scrubYears = data.states.slice(0, 3).map((state) => Number(state.id));

  svg.querySelector("[data-coast]").setAttribute("d", data.coast);

  // Fills live on a canvas: recolouring 150 Path2D shapes per frame is cheap, while
  // changing SVG fill attributes restyles and repaints the whole SVG each frame.
  const canvas = stage.querySelector("[data-fills]");
  const context2d = canvas.getContext("2d");
  const graticule = new Path2D(data.graticule);
  const atoms = data.atoms.map((atom) => {
    const colors = atom.c.map(hexToRgb);
    return { path: new Path2D(atom.d), x: atom.x, tag: atom.o[0], colors, shown: colors[0].slice(), from: colors[0], to: colors[0] };
  });
  const fit = { k: 1, ox: 0, oy: 0, scale: 1 };
  function sizeCanvas() {
    const width = lens.clientWidth;
    const height = lens.clientHeight;
    // Oversample by the largest camera zoom so the map stays sharp when the lens scales it.
    fit.scale = Math.min(devicePixelRatio || 1, 2);
    fit.k = Math.max(width / data.width, height / data.height);
    fit.ox = (width - data.width * fit.k) / 2;
    fit.oy = (height - data.height * fit.k) / 2;
    front.style.width = `${(FRONT_WIDTH * fit.k).toFixed(1)}px`;
    canvas.width = Math.round(width * fit.scale);
    canvas.height = Math.round(height * fit.scale);
    drawFills();
  }
  let drawQueued = false;
  // While colours are moving, the seam-hiding stroke is skipped: stroking 150 complex
  // shapes doubled the canvas cost per frame, and hairline seams are invisible in motion.
  let inMotion = false;
  let motionSettle = 0;
  function markMotion() {
    inMotion = true;
    clearTimeout(motionSettle);
    motionSettle = setTimeout(() => {
      inMotion = false;
      queueDraw();
    }, 160);
  }
  function drawFills() {
    drawQueued = false;
    const { k, ox, oy, scale } = fit;
    context2d.setTransform(1, 0, 0, 1, 0, 0);
    context2d.clearRect(0, 0, canvas.width, canvas.height);
    context2d.setTransform(k * scale, 0, 0, k * scale, ox * scale, oy * scale);
    context2d.lineJoin = "round";
    context2d.lineWidth = 0.6 / k;
    context2d.strokeStyle = "rgba(224, 166, 106, .16)";
    context2d.stroke(graticule);
    context2d.lineWidth = 0.5;
    for (const atom of atoms) {
      const color = rgbString(atom.shown);
      context2d.fillStyle = color;
      context2d.strokeStyle = color;
      context2d.fill(atom.path);
      if (!inMotion) context2d.stroke(atom.path);
    }
  }
  const queueDraw = () => {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(drawFills);
  };
  // Viewport point -> map viewBox point, through the lens transform.
  function atomAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * lens.clientWidth;
    const y = ((clientY - rect.top) / rect.height) * lens.clientHeight;
    const vx = (x - fit.ox) / fit.k;
    const vy = (y - fit.oy) / fit.k;
    context2d.setTransform(1, 0, 0, 1, 0, 0);
    for (let index = atoms.length - 1; index >= 0; index -= 1) {
      if (context2d.isPointInPath(atoms[index].path, vx, vy)) return atoms[index];
    }
    return null;
  }
  // Every group whose opacity moves on its own gets its own SVG, and so its own
  // compositor layer: fading one never repaints the thousands of paths around it.
  function layerSvg(className, before = null) {
    const layer = svgEl("svg", {
      class: `stage__map stage__layer ${className}`,
      viewBox: svg.getAttribute("viewBox"),
      preserveAspectRatio: svg.getAttribute("preserveAspectRatio"),
      "aria-hidden": "true",
    });
    return lens.insertBefore(layer, before);
  }
  const atlantropa = layerSvg("map-atlantropa", svg);
  // Atlantropa: sea and shoals keep their own look; reclaimed land takes its 1962 owner's colour.
  for (const layer of ["water", "shoal"]) {
    if (data.atlantropa[layer]) atlantropa.append(svgEl("path", { class: layer, "fill-rule": "evenodd", d: data.atlantropa[layer] }));
  }
  for (const land of data.atlantropa.land) {
    atlantropa.append(svgEl("path", { class: "land", "fill-rule": "evenodd", d: land.d, fill: land.c, stroke: land.c }));
  }
  const borderLayers = data.borders.map((d) => {
    const layer = layerSvg("map-borders");
    layer.append(svgEl("path", { d }));
    return layer;
  });
  const railGroup = layerSvg("map-rail");
  railGroup.hidden = true;
  // Rail arrives as compound paths, main lines first; each draws in along its own length.
  const railPaths = data.rail.map((d, index) => {
    const path = svgEl("path", { d, pathLength: "1", "stroke-dasharray": "1", "stroke-dashoffset": "1" });
    path.style.strokeWidth = Math.max(0.5, 1.5 - index * 0.09).toFixed(2);
    return railGroup.appendChild(path);
  });
  // The sweep line is an HTML layer moved by transform, not an SVG rect: moving the
  // rect invalidated the whole map SVG on every frame of every recolour.
  const front = lens.appendChild(Object.assign(document.createElement("div"), { className: "stage__front" }));
  front.dataset.front = "";
  let frontShown = false;
  // x is the sweep's left edge in viewBox units; FRONT_WIDTH units wide.
  function setFront(x, opacity) {
    if (opacity <= 0) {
      if (frontShown) front.style.opacity = "0";
      frontShown = false;
      return;
    }
    frontShown = true;
    front.style.opacity = opacity.toFixed(3);
    front.style.transform = `translate3d(${(fit.ox + x * fit.k).toFixed(1)}px, 0, 0)`;
  }
  const labelLayers = data.labels.map((labels) => {
    const layer = layerSvg("map-labels");
    for (const label of labels) {
      const text = svgEl("text", { x: label.x, y: label.y, "font-size": (label.s * 0.7).toFixed(1) });
      Object.assign(text.dataset, { en: label.t, zh: label.z });
      layer.append(text);
    }
    return layer;
  });
  const cityGroup = layerSvg("map-cities");
  cityGroup.hidden = true;
  const cities = data.cities.map((city, index) => {
    const group = svgEl("g", { opacity: "0" });
    const radius = 1.6 + Math.sqrt(city.p / 1e6) * 1.4;
    group.append(svgEl("circle", { class: "halo", cx: city.x, cy: city.y, r: (radius * 3.2).toFixed(1) }));
    group.append(svgEl("circle", { cx: city.x, cy: city.y, r: radius.toFixed(1) }));
    const text = svgEl("text", { x: city.x + radius + 4, y: city.y + 3 });
    Object.assign(text.dataset, { en: city.n, zh: city.z });
    if (index < 18) group.append(text);
    return cityGroup.appendChild(group);
  });

  const numeral = stage.querySelector("[data-year-numeral]");
  const family = stage.querySelector("[data-state-family]");
  const date = stage.querySelector("[data-state-date]");
  const tip = stage.querySelector("[data-paint-tip]");

  const view = { mode: "history", position: 0, style: "game", world: "1936" };
  const painted = new Map();
  const paintHistory = [];

  /* Colours: history interpolates directly; every other change sweeps west to east. */
  function styled(rgb) {
    if (view.style === "atlas") return lerpRgb(rgb, PAPER_RGB, 0.42);
    if (view.style === "ink") return lerpRgb(INK_RGB, rgb, 0.24);
    return rgb;
  }
  function targetRgb(atom) {
    switch (view.mode) {
      case "edit":
        return painted.has(atom.tag) ? hexToRgb(painted.get(atom.tag)) : atom.colors[0];
      case "style":
        return styled(painted.has(atom.tag) ? hexToRgb(painted.get(atom.tag)) : atom.colors[0]);
      case "context":
        return lerpRgb(INK_RGB, atom.colors[0], 0.3);
      default: {
        const state = WORLD_STATE[view.world];
        return state === null ? BLANK_RGB : atom.colors[state];
      }
    }
  }
  function paintAtom(atom, rgb) {
    atom.shown = rgb;
    queueDraw();
  }

  let sweep = null;
  function retarget(duration = TIMING.recolour) {
    for (const atom of atoms) {
      atom.from = atom.shown;
      atom.to = targetRgb(atom);
    }
    if (reducedMotion || duration === 0) {
      inMotion = false;
      atoms.forEach((atom) => paintAtom(atom, atom.to));
      setFront(0, 0);
      sweep = null;
      return;
    }
    const start = performance.now();
    const token = (sweep = {});
    const step = (now) => {
      if (sweep !== token) return;
      const t = clamp01((now - start) / duration);
      inMotion = t < 1;
      for (const atom of atoms) paintAtom(atom, lerpRgb(atom.from, atom.to, smooth(clamp01((t - atom.x * 0.3) / 0.7))));
      setFront(((t - 0.35) / 0.3) * data.width - FRONT_WIDTH / 2, t < 1 && view.mode === "worlds" ? Math.sin(Math.PI * t) : 0);
      if (t < 1) requestAnimationFrame(step);
      else sweep = null;
    };
    requestAnimationFrame(step);
  }

  function renderHistory() {
    const segment = Math.min(Math.floor(view.position), 1);
    const f = view.position - segment;
    // Seams are re-stroked once the scrubber stops, even between two dated stops.
    if (f > 0.001 && f < 0.999) markMotion();
    else inMotion = false;
    for (const atom of atoms) {
      const local = smooth(clamp01((f - atom.x * 0.35) / 0.65));
      paintAtom(atom, lerpRgb(atom.colors[segment], atom.colors[segment + 1], local));
    }
    setFront(((f - 0.325) / 0.35) * data.width - FRONT_WIDTH / 2, f > 0.001 && f < 0.999 ? Math.sin(Math.PI * f) : 0);
  }

  /* Borders, labels, Atlantropa, rail and cities follow the visible state. */
  function stateWeights() {
    if (view.mode === "history") return [0, 1, 2, 3].map((index) => clamp01(1 - Math.abs(view.position - index) * 1.4));
    if (view.mode === "worlds" || view.mode === "outro") {
      const state = WORLD_STATE[view.world];
      return [0, 1, 2, 3].map((index) => (index === state ? 1 : 0));
    }
    return [1, 0, 0, 0];
  }
  // A layer at zero is also hidden, so the compositor stops drawing it (the CSS keeps
  // it visible until its fade-out has finished).
  function fadeLayer(layer, opacity) {
    layer.style.opacity = opacity.toFixed(3);
    layer.style.visibility = opacity > 0 ? "visible" : "hidden";
  }
  function renderOverlays() {
    const weights = stateWeights();
    const context = view.mode === "context";
    borderLayers.forEach((layer, index) => fadeLayer(layer, weights[index] * (context ? 0.45 : 1)));
    labelLayers.forEach((layer, index) => {
      const weight = view.mode === "history" ? clamp01(1 - Math.abs(view.position - index) * 2.4) : weights[index];
      fadeLayer(layer, context ? 0 : weight);
    });
    fadeLayer(atlantropa, view.mode === "history" ? smooth(clamp01(view.position - 1)) : (view.mode === "worlds" || view.mode === "outro") && view.world === "1962" ? 1 : 0);
    railGroup.hidden = !context;
    cityGroup.hidden = !context;
  }

  // Rail and cities reveal once when the context chapter opens. Scroll-scrubbing them
  // re-rasterized thousands of rail segments on every scroll frame.
  let reveal = null;
  function renderReveal(t) {
    railPaths.forEach((path, index) => {
      const rank = index / railPaths.length;
      path.setAttribute("stroke-dashoffset", (1 - clamp01(t * 1.7 - rank * 0.7)).toFixed(3));
    });
    cities.forEach((city, index) => {
      city.setAttribute("opacity", clamp01((t * 2 - 0.45 - (index / cities.length) * 0.6) * 4).toFixed(3));
    });
  }
  function startReveal() {
    if (reducedMotion) {
      renderReveal(1);
      return;
    }
    const start = performance.now();
    const token = (reveal = {});
    const step = (now) => {
      if (reveal !== token) return;
      const t = clamp01((now - start) / TIMING.reveal);
      renderReveal(smooth(t));
      if (t < 1 && view.mode === "context") requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderHud() {
    const strings = copy();
    let stateId;
    if (view.mode === "history") {
      const segment = Math.min(Math.floor(view.position), 1);
      const f = view.position - segment;
      setText(numeral, String(Math.round(scrubYears[segment] + (scrubYears[segment + 1] - scrubYears[segment]) * smooth(f))));
      numeral.style.opacity = "";
      stateId = data.states[Math.round(view.position)].id;
    } else if (view.mode === "worlds" || view.mode === "outro") {
      stateId = view.world;
      setText(numeral, /^\d+$/.test(view.world) ? view.world : "");
    } else {
      stateId = "1936";
    }
    setText(family, strings.stateNames[stateId]);
    setText(date, strings.stateDates[stateId]);
  }

  function render() {
    if (view.mode === "history") renderHistory();
    renderOverlays();
    renderHud();
  }

  /* Labels: largest first; hide any that collide with a shown label or the page's own text. */
  let declutterTimer = 0;
  const scheduleDeclutter = (delay) => {
    clearTimeout(declutterTimer);
    declutterTimer = setTimeout(declutter, delay);
  };

  // Writes first, then every measurement in one pass, then the hide decisions:
  // interleaving them would force one layout per label.
  function declutter() {
    const blockers = [".stage-mark--tl", ".stage-mark--tr", ".nav__products"];
    if (view.mode === "history") blockers.push(".scrubber", ".caption--hero");
    else blockers.push(`[data-chapter="${view.mode}"] .caption`);
    const groups = [...labelLayers, cityGroup].map((group) => [...group.querySelectorAll("text")]);
    for (const texts of groups) {
      for (const text of texts) {
        text.removeAttribute("display");
        if (text.textContent !== text.dataset[language]) text.textContent = text.dataset[language];
      }
    }
    const blocked = blockers
      .map((selector) => document.querySelector(selector))
      .filter((node) => node && node.offsetParent !== null)
      .map((node) => toBox(node.getBoundingClientRect(), 8, 8));
    const boxes = groups.map((texts) => texts.map((text) => toBox(text.getBoundingClientRect(), 5, 3)));
    groups.forEach((texts, groupIndex) => {
      const kept = [...blocked];
      texts.forEach((text, index) => {
        const box = boxes[groupIndex][index];
        if (box.r - box.x < 12 || kept.some((other) => boxesOverlap(box, other))) text.setAttribute("display", "none");
        else kept.push(box);
      });
    });
  }

  // The SVG is slice-fitted: one viewBox unit is fit.k screen pixels.
  function setCamera() {
    const pan = innerWidth >= 760 ? CAMERAS[view.mode] ?? CAMERAS.history : CAMERAS.history;
    lens.style.transform = `translate(${(pan.x * fit.k).toFixed(1)}px, ${(pan.y * fit.k).toFixed(1)}px)`;
  }
  lens.addEventListener("transitionend", (event) => {
    // transitionend bubbles from every label and border inside the lens; only the camera move counts.
    if (event.target === lens && event.propertyName === "transform") scheduleDeclutter(0);
  });

  /* Public controls for the chapters. */
  const stageApi = {
    view,
    setMode(mode) {
      if (mode === view.mode) return;
      const fromHistory = view.mode === "history";
      view.mode = mode;
      story.dataset.mode = mode;
      // A cartography style belongs to its chapter; the rest of the story uses game colours.
      story.dataset.style = mode === "style" ? view.style : "game";
      setCamera();
      // History draws its own colours from the scrubber; drop any recolour still in flight.
      if (mode === "history") sweep = null;
      else retarget(fromHistory ? TIMING.recolourFromHistory : TIMING.recolour);
      if (mode === "context") startReveal();
      render();
      // Labels are measured after the camera settles.
      scheduleDeclutter(reducedMotion ? 0 : TIMING.settle);
      document.dispatchEvent(new CustomEvent("landing:mode", { detail: mode }));
    },
    setStyle(style) {
      if (style === view.style) return;
      view.style = style;
      if (view.mode !== "style") return;
      story.dataset.style = style;
      retarget(TIMING.style);
    },
    setWorld(world) {
      if (world === view.world) return;
      view.world = world;
      if (view.mode === "worlds" || view.mode === "outro") {
        retarget(TIMING.recolour);
        render();
      }
    },
    setPosition(position) {
      view.position = position;
      if (view.mode === "history") render();
    },
    paint(tag, colour) {
      const before = painted.get(tag) ?? null;
      if (before === colour) return false;
      paintHistory.push({ tag, before });
      painted.set(tag, colour);
      retarget(TIMING.paint);
      return true;
    },
    undo() {
      const last = paintHistory.pop();
      if (!last) return;
      if (last.before) painted.set(last.tag, last.before);
      else painted.delete(last.tag);
      retarget(TIMING.paint);
    },
    reset() {
      painted.clear();
      paintHistory.length = 0;
      retarget(TIMING.reset);
    },
    paintedCount: () => painted.size,
    canUndo: () => paintHistory.length > 0,
    nameOf: (tag) => data.names[0][tag]?.[language === "zh" ? 1 : 0] ?? tag,
    tip,
    svg,
    tagAt: (clientX, clientY) => atomAt(clientX, clientY)?.tag ?? null,
    hitTarget: canvas,
    stageMarks: stage,
  };

  let resizeTimer = 0;
  addEventListener("resize", () => {
    sizeCanvas();
    setCamera();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => scheduleDeclutter(0), 200);
  });
  document.addEventListener("landing:language", () => { declutter(); render(); });

  sizeCanvas();
  setCamera();
  render();
  declutter();
  return stageApi;
}

/* ---------- Chapter 0: history scrubber ---------- */

function initScrubber(stage) {
  const root = document.querySelector("[data-scrubber]");
  const track = root.querySelector("[data-track]");
  const thumb = root.querySelector("[data-thumb]");
  const fill = root.querySelector("[data-fill]");
  const ticks = [...root.querySelectorAll("[data-tick]")];
  const playButton = root.querySelector("[data-play]");
  const last = ticks.length - 1;
  let animation = null;
  let playing = !reducedMotion;
  let holdUntil = performance.now() + 1800;
  let direction = 1;

  function sync() {
    const position = stage.view.position;
    const ratio = position / last;
    thumb.style.left = `${ratio * 100}%`;
    fill.style.width = `${ratio * 100}%`;
    const nearest = Math.round(position);
    ticks.forEach((tick, index) => tick.classList.toggle("is-current", index === nearest));
    const year = Number(ticks[nearest].querySelector("b").textContent);
    track.setAttribute("aria-valuenow", year);
    track.setAttribute("aria-valuetext", ticks[nearest].textContent.trim());
  }
  function setPosition(position) {
    stage.setPosition(position);
    sync();
  }
  function animateTo(target, duration = 2600) {
    const from = stage.view.position;
    if (reducedMotion || from === target) {
      animation = null;
      setPosition(target);
      return;
    }
    const start = performance.now();
    const token = (animation = {});
    const step = (now) => {
      if (animation !== token) return;
      const t = clamp01((now - start) / (duration * Math.abs(target - from)));
      setPosition(from + (target - from) * easeInOut(t));
      if (t < 1) requestAnimationFrame(step);
      else {
        animation = null;
        holdUntil = performance.now() + 2200;
      }
    };
    requestAnimationFrame(step);
  }
  function setPlaying(next) {
    playing = next && !reducedMotion;
    playButton.dataset.state = playing ? "playing" : "paused";
    playButton.setAttribute("aria-label", copy()[playing ? "pauseLabel" : "playLabel"]);
    holdUntil = performance.now() + 600;
  }
  function autoplay(now) {
    if (playing && stage.view.mode === "history" && !animation && now > holdUntil && !document.hidden) {
      let next = Math.round(stage.view.position) + direction;
      if (next > last || next < 0) {
        direction *= -1;
        next = Math.round(stage.view.position) + direction;
      }
      animateTo(next);
    }
    requestAnimationFrame(autoplay);
  }
  const positionFromEvent = (event) => {
    const rect = track.getBoundingClientRect();
    return clamp01((event.clientX - rect.left) / rect.width) * last;
  };
  track.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-tick]")) return;
    setPlaying(false);
    animation = null;
    track.setPointerCapture(event.pointerId);
    setPosition(positionFromEvent(event));
  });
  track.addEventListener("pointermove", (event) => {
    if (track.hasPointerCapture(event.pointerId)) setPosition(positionFromEvent(event));
  });
  track.addEventListener("keydown", (event) => {
    const position = stage.view.position;
    const targets = { ArrowRight: Math.floor(position + 1e-6) + 1, ArrowLeft: Math.ceil(position - 1e-6) - 1, Home: 0, End: last };
    if (!(event.key in targets)) return;
    event.preventDefault();
    setPlaying(false);
    animateTo(Math.max(0, Math.min(last, targets[event.key])), 1800);
  });
  ticks.forEach((tick, index) => tick.addEventListener("click", () => { setPlaying(false); animateTo(index, 1800); }));
  playButton.addEventListener("click", () => setPlaying(!playing));
  document.addEventListener("landing:language", () => setPlaying(playing));
  setPlaying(playing);
  sync();
  requestAnimationFrame(autoplay);
}

/* ---------- Chapter 1: paint ---------- */

function initPaint(stage) {
  const chapter = document.querySelector('[data-chapter="edit"]');
  const counter = chapter.querySelector("[data-paint-count]");
  const undoButton = chapter.querySelector("[data-paint-undo]");
  const resetButton = chapter.querySelector("[data-paint-reset]");
  let colour = PAINT_COLOURS[0];
  const swatches = PAINT_COLOURS.map((value, index) => {
    const button = Object.assign(document.createElement("button"), { type: "button", className: "swatch" });
    button.style.setProperty("--c", value);
    button.setAttribute("role", "radio");
    button.setAttribute("aria-label", value);
    button.setAttribute("aria-checked", String(index === 0));
    button.addEventListener("click", () => {
      colour = value;
      swatches.forEach((swatch) => swatch.setAttribute("aria-checked", String(swatch === button)));
    });
    return chapter.querySelector("[data-swatches]").appendChild(button);
  });
  const sync = () => {
    counter.textContent = copy().paintCount(stage.paintedCount());
    undoButton.disabled = !stage.canUndo();
    resetButton.disabled = stage.paintedCount() === 0;
  };
  stage.hitTarget.addEventListener("click", (event) => {
    if (stage.view.mode !== "edit") return;
    const tag = stage.tagAt(event.clientX, event.clientY);
    if (tag && stage.paint(tag, colour)) sync();
  });
  stage.hitTarget.addEventListener("pointermove", (event) => {
    const tag = stage.view.mode === "edit" && event.pointerType === "mouse" ? stage.tagAt(event.clientX, event.clientY) : null;
    if (!tag) {
      stage.tip.hidden = true;
      return;
    }
    const box = stage.stageMarks.getBoundingClientRect();
    stage.tip.hidden = false;
    stage.tip.textContent = stage.nameOf(tag);
    stage.tip.style.left = `${event.clientX - box.left}px`;
    stage.tip.style.top = `${event.clientY - box.top}px`;
  });
  stage.hitTarget.addEventListener("pointerleave", () => { stage.tip.hidden = true; });
  undoButton.addEventListener("click", () => { stage.undo(); sync(); });
  resetButton.addEventListener("click", () => { stage.reset(); sync(); });
  document.addEventListener("landing:language", sync);
  sync();
}

/* ---------- Navigation: the scroll position is the single source of truth ---------- */

// Clicks never override state that scrolling would later overwrite; they move
// the page to where that state lives. While a programmatic scroll runs, scroll-
// derived updates pause, so the map does not flash through the chapters it passes.
const scrollNav = {
  active: false,
  timer: 0,
  listeners: [],
  go(top) {
    this.active = true;
    scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? "auto" : "smooth" });
    this.armSettle();
  },
  armSettle() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.settle(), 180);
  },
  settle() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.timer);
    this.listeners.forEach((listener) => listener());
  },
  onSettle(listener) {
    this.listeners.push(listener);
  },
};
addEventListener("scroll", () => { if (scrollNav.active) scrollNav.armSettle(); }, { passive: true });
addEventListener("scrollend", () => scrollNav.settle());
// Any direct scrolling input hands control back to the reader immediately.
for (const type of ["wheel", "touchstart"]) addEventListener(type, () => scrollNav.settle(), { passive: true });
addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key) && !event.target.closest?.("[role=slider], [role=radiogroup]")) scrollNav.settle();
});

function initAnchors() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const target = document.getElementById(link.getAttribute("href").slice(1));
    if (!target) return;
    event.preventDefault();
    history.replaceState(null, "", link.getAttribute("href"));
    scrollNav.go(target.getBoundingClientRect().top + scrollY);
  });
}

/* ---------- Chapters 2–4: scroll-stepped controls ---------- */

function chapterProgress(chapter) {
  const rect = chapter.getBoundingClientRect();
  return clamp01((innerHeight * 0.5 - rect.top) / Math.max(1, rect.height - innerHeight * 0.5));
}

// The page offset where a chapter's step sits in the middle of its scroll range.
function stepScrollTop(chapter, index, count) {
  const rect = chapter.getBoundingClientRect();
  const span = Math.max(1, rect.height - innerHeight * 0.5);
  return scrollY + rect.top - (innerHeight * 0.5 - ((index + 0.5) / count) * span);
}

// Radio groups: arrow keys move and select, as the ARIA pattern expects.
function bindRadioKeys(buttons, select) {
  buttons.forEach((button, index) => {
    button.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = buttons[(index + step + buttons.length) % buttons.length];
      next.focus();
      select(buttons.indexOf(next));
    });
  });
}

function initSteppedChapters(stage) {
  const styleChapter = document.querySelector('[data-chapter="style"]');
  const worldsChapter = document.querySelector('[data-chapter="worlds"]');
  const styleButtons = [...styleChapter.querySelectorAll("[data-style-option]")];
  const worldItems = [...worldsChapter.querySelectorAll("[data-world]")];
  const worldButtons = worldItems.map((item) => item.querySelector(".world__pick"));
  let styleStep = -1;
  let worldStep = -1;

  const showStyle = (index) => {
    styleStep = index;
    stage.setStyle(STYLES[index]);
    styleButtons.forEach((button, i) => {
      button.setAttribute("aria-checked", String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
  };
  const showWorld = (index) => {
    worldStep = index;
    stage.setWorld(WORLDS[index]);
    worldItems.forEach((item, i) => item.classList.toggle("is-active", i === index));
    worldButtons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
  };
  // A choice applies at once, then the page glides to where that step lives.
  const chooseStyle = (index) => {
    showStyle(index);
    scrollNav.go(stepScrollTop(styleChapter, index, STYLES.length));
  };
  const chooseWorld = (index) => {
    showWorld(index);
    scrollNav.go(stepScrollTop(worldsChapter, index, WORLDS.length));
  };
  styleButtons.forEach((button, index) => button.addEventListener("click", () => chooseStyle(index)));
  worldButtons.forEach((button, index) => button.addEventListener("click", () => chooseWorld(index)));
  bindRadioKeys(styleButtons, chooseStyle);

  return () => {
    if (scrollNav.active) return;
    const nextStyle = Math.min(STYLES.length - 1, Math.floor(chapterProgress(styleChapter) * STYLES.length));
    if (nextStyle !== styleStep) showStyle(nextStyle);
    const nextWorld = Math.min(WORLDS.length - 1, Math.floor(chapterProgress(worldsChapter) * WORLDS.length));
    if (nextWorld !== worldStep) showWorld(nextWorld);
  };
}

function initChapters(stage) {
  const chapters = [...document.querySelectorAll("[data-chapter]")];
  const outro = document.querySelector('[data-chapter="outro"]');
  const veil = document.querySelector("[data-stage-veil]");
  return () => {
    // The chapter under the middle of the screen owns the stage; computed from
    // layout on each frame so it can never lag behind or race a click.
    if (!scrollNav.active) {
      const middle = innerHeight * 0.5;
      const current = chapters.find((chapter) => {
        const rect = chapter.getBoundingClientRect();
        return rect.top <= middle && rect.bottom > middle;
      });
      if (current) stage.setMode(current.dataset.chapter);
    }
    // The stage fades to ink over the outro, so the HGO plate can rise out of the same darkness.
    const rect = outro.getBoundingClientRect();
    veil.style.opacity = clamp01((innerHeight - rect.top) / Math.max(1, rect.height)).toFixed(3);
  };
}

/* ---------- HGO Atlas ---------- */

async function initHgo() {
  const meta = await fetch("./assets/hgo-zoom.json").then((response) => response.json());
  const section = document.querySelector("[data-hgo]");
  const stage = section.querySelector(".hgo__stage");
  const camera = section.querySelector("[data-camera]");
  const veil = section.querySelector("[data-hgo-veil]");
  const steps = [...section.querySelectorAll("[data-step]")];
  const counters = [...section.querySelectorAll("[data-count]")];
  const zoomOut = section.querySelector("[data-zoom]");
  const pxOut = section.querySelector("[data-px]");
  const pyOut = section.querySelector("[data-py]");
  const { native, detail, focus } = meta;
  const placeImage = (image, src, box) => {
    image.src = src;
    Object.assign(image.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
  };
  placeImage(section.querySelector("[data-hgo-world]"), meta.world.src, { x: 0, y: 0, ...native });
  placeImage(section.querySelector("[data-hgo-detail]"), detail.src, detail);
  const centre = { x: detail.x + detail.width / 2, y: detail.y + detail.height / 2 };

  // Native-pixel keyframes: the whole world, a slow push into Europe, then far enough
  // in that the mod's own pixels show. Holds give each caption time to be read, and the
  // plate ends on the pixels and fades out rather than snapping back.
  function keyframes(width, height) {
    const narrow = width < 760;
    const fit = Math.max(width / native.width, height / native.height) * (narrow ? 1.6 : 1.05);
    const detailScale = (width * (narrow ? 1.25 : 0.62)) / detail.width;
    const world = { s: fit, x: narrow ? centre.x : native.width / 2, y: narrow ? centre.y + 140 : native.height * 0.46 };
    const crop = { s: detailScale, x: centre.x, y: centre.y };
    const pixel = { s: narrow ? 6 : 8, x: focus.x, y: focus.y };
    return [
      { at: 0.08, ...world },
      { at: 0.42, ...crop },
      { at: 0.52, ...crop },
      { at: 0.8, ...pixel },
    ];
  }
  function cameraAt(progress, frames) {
    if (progress <= frames[0].at) return frames[0];
    for (let index = 1; index < frames.length; index += 1) {
      const a = frames[index - 1];
      const b = frames[index];
      if (progress > b.at) continue;
      let t = easeInOut((progress - a.at) / (b.at - a.at));
      if (reducedMotion) t = Math.round(t);
      const s = Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * t);
      const w = a.s === b.s ? t : (s - a.s) / (b.s - a.s);
      return { s, x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
    }
    return frames[frames.length - 1];
  }

  function render(progress) {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const view = cameraAt(progress, keyframes(width, height));
    const anchorX = width * (width < 760 ? 0.5 : 0.64);
    const anchorY = height * (width < 760 ? 0.34 : 0.5);
    camera.style.transform = `translate(${anchorX - view.x * view.s}px, ${anchorY - view.y * view.s}px) scale(${view.s})`;
    section.dataset.detail = view.s > 0.5 ? "on" : "off";
    veil.style.opacity = progress < 0.08 ? (1 - progress / 0.08).toFixed(3) : progress > 0.9 ? ((progress - 0.9) / 0.1).toFixed(3) : "0";
    steps.forEach((step, index) => step.classList.toggle("is-active", index === (progress < 0.5 ? 0 : 1)));
    const counted = reducedMotion ? 1 : smooth(clamp01((progress - 0.08) / 0.34));
    const formatter = new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US");
    counters.forEach((node) => setText(node, formatter.format(Math.round(meta.counts[node.dataset.count] * counted))));
    setText(zoomOut, `×${view.s < 1 ? view.s.toFixed(2) : view.s.toFixed(1)}`);
    setText(pxOut, String(Math.round(view.x)));
    setText(pyOut, String(Math.round(view.y)));
  }

  // The camera follows the scroll position through a short exponential ease, so each
  // wheel notch becomes a glide instead of a jump in zoom.
  let shown = null;
  let target = 0;
  let last = 0;
  let gliding = false;
  const glide = (now) => {
    const dt = Math.min(64, now - last);
    last = now;
    shown += (target - shown) * (1 - Math.exp(-dt / 140));
    if (Math.abs(target - shown) < 0.0005) shown = target;
    render(shown);
    gliding = shown !== target;
    if (gliding) requestAnimationFrame(glide);
  };
  let renderedSize = "";
  return () => {
    const rect = section.getBoundingClientRect();
    target = clamp01(-rect.top / Math.max(1, rect.height - innerHeight));
    // The camera's scale and anchor come from the stage size, so a resize redraws it
    // even when the scroll progress has not moved.
    const size = `${stage.clientWidth}x${stage.clientHeight}`;
    const resized = size !== renderedSize;
    renderedSize = size;
    // Off screen (or a jump past it), the camera snaps: nobody should see it glide in.
    const offscreen = rect.bottom < 0 || rect.top > innerHeight;
    if (shown === null || reducedMotion || offscreen) {
      if (shown === target && !resized) return;
      shown = target;
      render(shown);
      return;
    }
    if (resized && !gliding) render(shown);
    if (!gliding && shown !== target) {
      gliding = true;
      last = performance.now();
      requestAnimationFrame(glide);
    }
  };
}

/* ---------- Boot ---------- */

function initReveal() {
  const nodes = document.querySelectorAll("[data-reveal]");
  if (reducedMotion || !("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("is-in"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -10% 0px" });
  nodes.forEach((node) => observer.observe(node));
}

function boot() {
  document.documentElement.classList.add("js");
  if (language !== "en") applyLanguage(language);
  document.querySelector("[data-lang-toggle]").addEventListener("click", () => applyLanguage(language === "en" ? "zh" : "en"));
  initReveal();
  initAnchors();

  const nav = document.querySelector(".nav");
  const scrollWork = [() => nav.classList.toggle("is-scrolled", scrollY > innerHeight * 0.6)];
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scrollWork.forEach((work) => work());
    });
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  document.addEventListener("landing:language", schedule);

  fetch("./assets/history-scrubber.json")
    .then((response) => response.json())
    .then((data) => {
      const stage = initStage(data);
      initScrubber(stage);
      initPaint(stage);
      scrollWork.push(initChapters(stage), initSteppedChapters(stage));
      scrollNav.onSettle(schedule);
      schedule();
    })
    .catch((error) => console.warn("Map data unavailable", error));
  initHgo()
    .then((update) => { scrollWork.push(update); schedule(); })
    .catch((error) => console.warn("HGO plate unavailable", error));
  schedule();
}

boot();
