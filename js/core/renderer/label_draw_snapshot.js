import { coversViewport, transformCoverage } from "./cached_surface_coverage.js";
import { pageResourceBudget } from "../runtime_resource_budget.js";

const STYLE_KEYS = ["font", "textAlign", "textBaseline", "direction", "fontKerning",
  "fontStretch", "fontVariantCaps", "letterSpacing", "wordSpacing", "textRendering",
  "fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "miterLimit", "globalAlpha",
  "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY", "imageSmoothingEnabled", "imageSmoothingQuality"];
const SUPPORTED_PASSES = new Set(["labels", "textureLabels"]);
const SUPPORTED_PAINT = new Set(["fillText", "strokeText", "drawImage"]);
const UNSUPPORTED_PAINT = new Set(["fill", "stroke", "fillRect", "strokeRect", "clearRect", "putImageData", "clip"]);
const MAX_RECORDS = 8192;
const MAX_BYTES = 8 * 1024 * 1024;

function validTransform(transform) {
  return [transform?.x, transform?.y, transform?.k].every(Number.isFinite) && transform.k > 0;
}

function validSize(canvas) {
  return Number.isSafeInteger(canvas?.width) && canvas.width > 0
    && Number.isSafeInteger(canvas?.height) && canvas.height > 0;
}

// Capture only accepted text/sprite paints from a label pass. Replaying these
// records never measures text, computes placements or starts a layout worker.
// Unsupported paints reject the entire snapshot rather than omit content.
// The caller supplies an unclipped context and runs target clearing outside capture.
export function createLabelDrawSnapshotOwner({ resourceBudget = pageResourceBudget } = {}) {
  const resourceOwner = Symbol("label-draw-snapshots");
  const snapshots = new Map();
  const capturing = new Set();
  let generation = 0;

  function discardPacket(packet) {
    packet.supported = false;
    packet.records.length = 0;
    packet.bytes = 0;
    packet.images.clear();
    packet.imageSizes.clear();
  }

  function retention() {
    for (const [name, packet] of snapshots) {
      if ([...packet.imageSizes].some(([image, size]) => image.width !== size.width || image.height !== size.height)) {
        snapshots.delete(name);
      }
    }
    for (const packet of capturing) {
      if ([...packet.imageSizes].some(([image, size]) => image.width !== size.width || image.height !== size.height)) discardPacket(packet);
    }
    let bytes = 0;
    let count = 0;
    const images = new Set();
    for (const packet of [...snapshots.values(), ...capturing]) {
      bytes += packet.bytes;
      count += packet.records.length;
      for (const image of packet.images) images.add(image);
    }
    let imageBytes = 0;
    for (const image of images) imageBytes += image.width * image.height * 4;
    return { bytes, imageBytes, count, images };
  }

  function account() {
    const { bytes, imageBytes } = retention();
    if (bytes || imageBytes) resourceBudget.update(resourceOwner, { transport: bytes, bitmaps: imageBytes });
    else resourceBudget.release(resourceOwner);
  }

  function clear() {
    generation++;
    snapshots.clear();
    for (const packet of capturing) {
      discardPacket(packet);
    }
    account();
  }

  function capture(passName, context, { transform, dpr, layout = null, signature }, draw) {
    snapshots.delete(passName);
    account();
    if (!SUPPORTED_PASSES.has(passName) || typeof context?.getTransform !== "function"
      || !validSize(context.canvas) || !validTransform(transform) || !Number.isFinite(dpr) || dpr <= 0
      || typeof signature !== "string") return draw(context);

    const offsetX = Number(layout?.offsetX ?? 0);
    const offsetY = Number(layout?.offsetY ?? 0);
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return draw(context);

    const capturedGeneration = generation;
    const referenceTransform = { x: transform.x, y: transform.y, k: transform.k };
    const packet = { records: [], bytes: 0, images: new Set(), imageSizes: new Map(), supported: true };
    const width = context.canvas.width, height = context.canvas.height;
    capturing.add(packet);
    function rejectPacket() {
      discardPacket(packet);
      account();
    }
    function recordPaint(method, args) {
      if (!packet.supported) return;
      if (context.filter && context.filter !== "none"
        || context.globalCompositeOperation !== "source-over"
        || typeof context.getLineDash === "function" && context.getLineDash().length) {
        rejectPacket();
        return;
      }
      const matrix = context.getTransform();
      let x, y, record;
      if (method === "drawImage") {
        const image = args[0];
        if (image === context.canvas || !validSize(image) || !Number.isSafeInteger(image.width * image.height * 4)
          || image.width * image.height * 4 > MAX_BYTES || ![3, 5, 9].includes(args.length)
          || !args.slice(1).every(Number.isFinite)) { rejectPacket(); return; }
        const start = args.length === 9 ? 5 : 1;
        const width = args.length === 3 ? image.width : args[start + 2];
        const height = args.length === 3 ? image.height : args[start + 3];
        if (!width || !height || args.length === 9 && (!args[3] || !args[4])) { rejectPacket(); return; }
        x = args[start] + width / 2;
        y = args[start + 1] + height / 2;
        record = { image, imageWidth: image.width, imageHeight: image.height,
          args: args.length === 9 ? [...args.slice(1, 5), -width / 2, -height / 2, width, height]
            : [-width / 2, -height / 2, width, height] };
      } else {
        // Do not coerce user objects twice; native painting owns their conversion.
        if (args[0] !== null && (typeof args[0] === "object" || typeof args[0] === "function")
          || !Number.isFinite(args[1]) || !Number.isFinite(args[2])
          || args.length > 3 && !(Number.isFinite(args[3]) && args[3] > 0)) { rejectPacket(); return; }
        x = args[1]; y = args[2];
        record = { text: String(args[0]), maxWidth: args[3] };
        if (!record.text) return;
      }
      const screenX = (matrix.a * x + matrix.c * y + matrix.e) / dpr;
      const screenY = (matrix.b * x + matrix.d * y + matrix.f) / dpr;
      const linear = [matrix.a, matrix.b, matrix.c, matrix.d].map((value) => value / dpr);
      const anchor = [(screenX - offsetX - referenceTransform.x) / referenceTransform.k,
        (screenY - offsetY - referenceTransform.y) / referenceTransform.k];
      if (![screenX, screenY, ...linear, ...anchor].every(Number.isFinite)) { rejectPacket(); return; }
      const style = Object.fromEntries(STYLE_KEYS.filter((key) => context[key] !== undefined)
        .map((key) => [key, context[key]]));
      if (typeof style.fillStyle !== "string" || typeof style.strokeStyle !== "string"
        || Object.values(style).some((value) => !["string", "number", "boolean"].includes(typeof value)
          || typeof value === "number" && !Number.isFinite(value))) { rejectPacket(); return; }
      const recordBytes = 512 + (record.text?.length || 0) * 2
        + Object.values(style).reduce((sum, value) => sum + (typeof value === "string" ? value.length * 2 : 0), 0);
      const retained = retention();
      if (!packet.supported) return;
      const imageBytes = record.image && !retained.images.has(record.image) ? record.imageWidth * record.imageHeight * 4 : 0;
      if (retained.count >= MAX_RECORDS || retained.bytes + retained.imageBytes + recordBytes + imageBytes > MAX_BYTES) {
        rejectPacket();
        return;
      }
      packet.records.push({ ...record, method, linear, style, anchor });
      packet.bytes += recordBytes;
      if (record.image) {
        packet.images.add(record.image);
        packet.imageSizes.set(record.image, { width: record.imageWidth, height: record.imageHeight });
      }
      account();
    }
    const proxy = new Proxy(context, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (SUPPORTED_PAINT.has(key)) return (...args) => {
          try { recordPaint(key, args); } catch { rejectPacket(); }
          return value.apply(target, args);
        };
        if (UNSUPPORTED_PAINT.has(key)) return (...args) => {
          rejectPacket();
          return value.apply(target, args);
        };
        return value.bind(target);
      },
      set(target, key, value) { return Reflect.set(target, key, value, target); },
    });
    let published = false;
    try {
      const result = draw(proxy);
      if (result && typeof result.then === "function") {
        rejectPacket();
        throw new TypeError("Label snapshot capture requires synchronous drawing.");
      }
      if (packet.supported && generation === capturedGeneration && context.canvas.width === width && context.canvas.height === height) {
        snapshots.set(passName, { ...packet, transform: referenceTransform, dpr, signature, width, height, offsetX, offsetY });
        published = true;
      }
      return result;
    } finally {
      if (!published) discardPacket(packet);
      capturing.delete(packet);
      account();
    }
  }

  function canReplay(passNames, context, transform, dpr, getSignature) {
    if (!Array.isArray(passNames) || !validSize(context?.canvas) || !validTransform(transform)
      || !Number.isFinite(dpr) || dpr <= 0 || typeof getSignature !== "function") return false;
    account();
    return passNames.every((name) => {
      const packet = snapshots.get(name);
      if (!packet) return false;
      try { if (getSignature(name, { ...packet.transform }) !== packet.signature) return false; }
      catch { return false; }
      if (snapshots.get(name) !== packet) return false;
      const ratio = transform.k / packet.transform.k;
      if (ratio < 0.8 || ratio > 1.25) return false;
      const coverage = transformCoverage({ minX: -packet.offsetX, minY: -packet.offsetY,
        maxX: packet.width / packet.dpr - packet.offsetX,
        maxY: packet.height / packet.dpr - packet.offsetY }, packet.transform, transform);
      if (!coversViewport(coverage, context.canvas.width / dpr, context.canvas.height / dpr)) return false;
      return packet.records.every((record) => !record.image
        || record.image.width === record.imageWidth && record.image.height === record.imageHeight);
    });
  }

  function replay(passNames, context, transform, dpr, getSignature) {
    if (!canReplay(passNames, context, transform, dpr, getSignature)) return false;
    context.save();
    try {
      context.globalCompositeOperation = "source-over";
      context.filter = "none";
      for (const name of passNames) for (const record of snapshots.get(name).records) {
        Object.assign(context, record.style);
        context.setTransform(...record.linear.map((value) => value * dpr),
          (record.anchor[0] * transform.k + transform.x) * dpr,
          (record.anchor[1] * transform.k + transform.y) * dpr);
        if (record.image) context.drawImage(record.image, ...record.args);
        else if (record.maxWidth !== undefined) context[record.method](record.text, 0, 0, record.maxWidth);
        else context[record.method](record.text, 0, 0);
      }
    } finally { context.restore(); }
    return true;
  }

  return Object.freeze({ capture, canReplay, replay, clear });
}
