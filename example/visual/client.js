// @ts-check
/// <reference lib="dom" />

/** @typedef {import("./contracts.ts").DemoSnapshot} DemoSnapshot */
/** @typedef {import("./contracts.ts").DemoCommand} DemoCommand */

/**
 * @template {HTMLElement} T
 * @param {string} selector
 * @param {new () => T} type
 * @returns {T}
 */
function requireElement(selector, type) {
  const element = document.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Missing demo element ${selector}`);
  return element;
}
const canvas = requireElement("#stage", HTMLCanvasElement);
const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
if (context === null) throw new Error("Canvas 2D rendering is unavailable.");
const DEVICE_DPR = devicePixelRatio || 1;
const state = {
  worldWidth: 1920,
  worldHeight: 1080,
  stride: 11,
  renderBudget: 900,
  snapshotIntervalMs: 1000 / 20,
  pulse: [960, 540, 0],
  metrics: /** @type {Partial<import("./contracts.ts").SnapshotMetrics>} */ ({}),
  mode: /** @type {import("./contracts.ts").DemoMode} */ ("orbit"),
  running: true,
  connected: false,
  hueShift: 0,
  drawMs: 0,
  pixelRatio: Math.min(DEVICE_DPR, 2),
};

// Ring of two authoritative snapshots + one interpolated frame buffer.
// Render is delayed by ~1 snapshot so we lerp prev→curr instead of
// velocity-extrapolating (which snaps when steering diverges).
const snapSlots = [
  { data: new Float32Array(0), floats: 0, at: 0 },
  { data: new Float32Array(0), floats: 0, at: 0 },
];
let currSnap = 0;
let interpEntities = new Float32Array(0);
// prev-snapshot offset by entity id (-1 = absent). Sized for world capacity.
const prevOffsetByEntity = new Int32Array(32001).fill(-1);

const COLOR_BUCKETS = 48;
const bucketCounts = new Uint32Array(COLOR_BUCKETS);
const bucketStarts = new Uint32Array(COLOR_BUCKETS);
const bucketCursor = new Uint32Array(COLOR_BUCKETS);
let bucketOffsets = new Uint32Array(4096);
const teamRotationCos = new Float32Array(4);
const teamRotationSin = new Float32Array(4);
const colorCache = new Map();

/** @param {number} floats */
const ensureFloatCapacity = (floats) => {
  if (interpEntities.length >= floats) return;
  let next = Math.max(interpEntities.length, 1024);
  while (next < floats) next *= 2;
  interpEntities = new Float32Array(next);
};

/** @param {string} b64 @param {number} at */
const writeSnapshot = (b64, at) => {
  const bytes = typeof Uint8Array.fromBase64 === "function" ? Uint8Array.fromBase64(b64) : (() => {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  })();
  const floatCount = bytes.byteLength / 4;
  const next = currSnap ^ 1;
  const slot = snapSlots[next];
  if (slot.data.length < floatCount) slot.data = new Float32Array(floatCount);
  slot.data.set(new Float32Array(bytes.buffer, bytes.byteOffset, floatCount));
  slot.floats = floatCount;
  slot.at = at;
  currSnap = next;

  const prev = snapSlots[currSnap ^ 1];
  if (prev.at === 0) {
    // First snapshot: mirror so interpolation has a valid prev.
    if (prev.data.length < floatCount) prev.data = new Float32Array(floatCount);
    prev.data.set(slot.data.subarray(0, floatCount));
    prev.floats = floatCount;
    prev.at = at - state.snapshotIntervalMs;
  }

  // Index prev by entity id for order-independent lerp (sparks spawn/despawn).
  prevOffsetByEntity.fill(-1);
  const stride = state.stride;
  for (let o = 0; o < prev.floats; o += stride) {
    const id = prev.data[o + 10] | 0;
    if (id >= 0 && id < prevOffsetByEntity.length) prevOffsetByEntity[id] = o;
  }
};

/** Build positions delayed by one snapshot interval (smooth lerp, no catch-up snap). */
/** @param {number} now */
const buildInterpolatedEntities = (now) => {
  const curr = snapSlots[currSnap];
  const prev = snapSlots[currSnap ^ 1];
  const stride = state.stride;
  if (curr.floats === 0) return curr.data.subarray(0, 0);

  const span = Math.max(1, curr.at - prev.at);
  const delay = Math.min(140, Math.max(35, state.snapshotIntervalMs || span));
  const renderTime = now - delay;
  let alpha = (renderTime - prev.at) / span;
  if (!Number.isFinite(alpha)) alpha = 1;

  ensureFloatCapacity(curr.floats);
  const out = interpEntities;
  const a = prev.data;
  const b = curr.data;

  if (alpha <= 0) {
    out.set(b.subarray(0, curr.floats));
    return out.subarray(0, curr.floats);
  }

  const coastSec = alpha >= 1 ? Math.min((alpha - 1) * span, delay * 0.35) / 1000 : 0;
  const t = alpha >= 1 ? 1 : alpha;
  const inv = 1 - t;

  for (let o = 0; o < curr.floats; o += stride) {
    const id = b[o + 10] | 0;
    const prevO = id >= 0 && id < prevOffsetByEntity.length ? prevOffsetByEntity[id] : -1;
    if (prevO >= 0) {
      out[o] = a[prevO] * inv + b[o] * t;
      out[o + 1] = a[prevO + 1] * inv + b[o + 1] * t;
      if (coastSec > 0) {
        out[o] += b[o + 2] * coastSec;
        out[o + 1] += b[o + 3] * coastSec;
      }
      out[o + 5] = a[prevO + 5] * inv + b[o + 5] * t;
      out[o + 6] = a[prevO + 6] * inv + b[o + 6] * t;
      out[o + 7] = a[prevO + 7] * inv + b[o + 7] * t;
    } else {
      out[o] = b[o] + b[o + 2] * coastSec;
      out[o + 1] = b[o + 1] + b[o + 3] * coastSec;
      out[o + 5] = b[o + 5];
      out[o + 6] = b[o + 6];
      out[o + 7] = b[o + 7];
    }
    out[o + 2] = b[o + 2];
    out[o + 3] = b[o + 3];
    out[o + 4] = b[o + 4];
    out[o + 8] = b[o + 8];
    out[o + 9] = b[o + 9];
    out[o + 10] = b[o + 10];
  }
  return out.subarray(0, curr.floats);
};

const ids = {
  entities: requireElement("#entities", HTMLElement),
  tick: requireElement("#tick", HTMLElement),
  draw: requireElement("#draw", HTMLElement),
  drones: requireElement("#drones", HTMLElement),
  heap: requireElement("#heap", HTMLElement),
  rendered: requireElement("#rendered", HTMLElement),
  exited: requireElement("#exited", HTMLElement),
  capacity: requireElement("#capacity", HTMLElement),
  spawned: requireElement("#spawned", HTMLElement),
  destroyed: requireElement("#destroyed", HTMLElement),
  droneTarget: requireElement("#droneTarget", HTMLElement),
  droneControl: requireElement("#droneControl", HTMLInputElement),
  renderTarget: requireElement("#renderTarget", HTMLElement),
  renderControl: requireElement("#renderControl", HTMLInputElement),
  toggle: requireElement("#toggle", HTMLButtonElement),
};

/** @param {number} entityCount */
const targetPixelRatio = (entityCount) => {
  if (entityCount > 12000) return 1;
  if (entityCount > 5000) return Math.min(DEVICE_DPR, 1.25);
  if (entityCount > 2000) return Math.min(DEVICE_DPR, 1.5);
  return Math.min(DEVICE_DPR, 2);
};

const resize = () => {
  const ratio = state.pixelRatio;
  canvas.width = Math.floor(innerWidth * ratio);
  canvas.height = Math.floor(innerHeight * ratio);
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
};

/** @param {number} count */
const ensureBucketCapacity = (count) => {
  if (bucketOffsets.length >= count) return;
  let next = bucketOffsets.length;
  while (next < count) next *= 2;
  bucketOffsets = new Uint32Array(next);
};

/** @param {DemoCommand} payload */
const command = (payload) =>
  fetch("/api/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);

let pendingIntensity = 1;
let intensityFrame = 0;

/** @param {number} value */
const scheduleIntensityCommand = (value) => {
  pendingIntensity = value;
  if (intensityFrame !== 0) return;
  intensityFrame = requestAnimationFrame(() => {
    intensityFrame = 0;
    command({ action: "intensity", value: pendingIntensity });
  });
};

const updateHud = () => {
  const metrics = state.metrics;
  ids.entities.textContent = String(metrics.active ?? 0);
  ids.tick.textContent = String(metrics.tickMs ?? 0) + "ms";
  ids.draw.textContent = state.drawMs.toFixed(1) + "ms";
  ids.drones.textContent = String(metrics.drones ?? 0);
  ids.heap.textContent = String(metrics.heapMb ?? 0) + "mb";
  ids.rendered.textContent = String(metrics.rendered ?? 0);
  ids.exited.textContent = String(metrics.exited ?? 0);
  ids.capacity.textContent = String(metrics.capacity ?? 0);
  ids.spawned.textContent = String(metrics.spawned ?? 0);
  ids.destroyed.textContent = String(metrics.destroyed ?? 0);
  ids.droneTarget.textContent = String(metrics.droneTarget ?? ids.droneControl.value);
  if (document.activeElement !== ids.droneControl && metrics.droneTarget) {
    ids.droneControl.value = String(metrics.droneTarget);
  }
  state.renderBudget = metrics.renderLimit ?? state.renderBudget;
  ids.renderTarget.textContent = String(state.renderBudget);
  if (document.activeElement !== ids.renderControl && metrics.renderLimit) {
    ids.renderControl.value = String(metrics.renderLimit);
  }
  ids.toggle.textContent = state.running ? "Pause" : "Resume";
  document.querySelectorAll("button[data-mode]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button instanceof HTMLButtonElement && button.dataset.mode === state.mode),
    );
  });
};

const stream = () => {
  const events = new EventSource("/events");
  events.addEventListener("open", () => {
    state.connected = true;
    updateHud();
  });
  events.addEventListener("error", () => {
    state.connected = false;
    updateHud();
  });
  events.addEventListener("snapshot", (event) => {
    const payload = /** @type {DemoSnapshot} */ (JSON.parse(event.data));
    const now = performance.now();
    const prevAt = snapSlots[currSnap].at;
    if (prevAt > 0) {
      state.snapshotIntervalMs = Math.min(140, Math.max(35, now - prevAt));
    }
    if (payload.entitiesB64) writeSnapshot(payload.entitiesB64, now);
    state.stride = payload.stride;
    state.metrics = payload.metrics;
    state.mode = payload.mode;
    state.running = payload.running;
    state.worldWidth = payload.width;
    state.worldHeight = payload.height;
    state.pulse = payload.pulse;
    const nextRatio = targetPixelRatio(state.metrics.rendered ?? 0);
    if (Math.abs(nextRatio - state.pixelRatio) > 0.01) {
      state.pixelRatio = nextRatio;
      resize();
    }
    updateHud();
  });
};

/** @param {number} width @param {number} height */
const clearStage = (width, height) => {
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.fillStyle = "rgb(3 4 4)";
  context.fillRect(0, 0, width, height);
};

/** @param {number} scaleX @param {number} scaleY */
const drawPulse = (scaleX, scaleY) => {
  const [x, y, strength] = state.pulse;
  if (strength <= 0.01) return;
  const screenX = x * scaleX;
  const screenY = y * scaleY;
  const radius = (1 - strength) * Math.min(innerWidth, innerHeight) * 0.44 + 24;
  context.save();
  context.globalCompositeOperation = "lighter";
  context.strokeStyle = "rgb(128 244 224 / " + (0.28 * strength) + ")";
  context.lineWidth = 2 + strength * 8;
  context.beginPath();
  context.arc(screenX, screenY, radius, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = "rgb(255 199 94 / " + (0.18 * strength) + ")";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(screenX, screenY, radius * 0.62, 0, Math.PI * 2);
  context.stroke();
  context.restore();
};

/** @param {number} time */
const updateTeamRotations = (time) => {
  const baseAngle = time * 0.35;
  for (let team = 0; team < 4; team++) {
    const angle = baseAngle + team * 0.18;
    teamRotationCos[team] = Math.cos(angle);
    teamRotationSin[team] = Math.sin(angle);
  }
};

/** @param {number} hue @param {number} lightness */
const colorFor = (hue, lightness) => {
  const key = ((hue | 0) * 128) + (lightness | 0);
  let color = colorCache.get(key);
  if (!color) {
    color = "hsl(" + (hue | 0) + " 92% " + lightness + "%)";
    colorCache.set(key, color);
  }
  return color;
};

/** @param {number} count */
const detailLevel = (count) => {
  if (count > 10000) return 0;
  if (count > 4500) return 1;
  if (count > 1600) return 2;
  return 3;
};

/** @param {Float32Array} entities @param {number} maxOffset @param {number} stride @param {number} hueShift */
const fillBuckets = (entities, maxOffset, stride, hueShift) => {
  const count = maxOffset / stride;
  ensureBucketCapacity(count);
  bucketCounts.fill(0);
  for (let offset = 0; offset < maxOffset; offset += stride) {
    const hue = entities[offset + 4] + hueShift;
    const bucket = ((hue % 360) + 360) % 360 / 360 * COLOR_BUCKETS | 0;
    bucketCounts[bucket]++;
  }
  let start = 0;
  for (let b = 0; b < COLOR_BUCKETS; b++) {
    bucketStarts[b] = start;
    bucketCursor[b] = start;
    start += bucketCounts[b];
  }
  for (let offset = 0, index = 0; offset < maxOffset; offset += stride, index++) {
    const hue = entities[offset + 4] + hueShift;
    const bucket = ((hue % 360) + 360) % 360 / 360 * COLOR_BUCKETS | 0;
    bucketOffsets[bucketCursor[bucket]++] = offset;
  }
};

/** @param {Float32Array} entities @param {number} offset @param {number} scaleX @param {number} scaleY */
const drawEntityFull = (entities, offset, scaleX, scaleY) => {
  const x = entities[offset];
  const y = entities[offset + 1];
  const velocityX = entities[offset + 2];
  const velocityY = entities[offset + 3];
  const hue = entities[offset + 4];
  const size = entities[offset + 5];
  const alpha = entities[offset + 6];
  const energy = entities[offset + 7];
  const team = entities[offset + 8];
  const kind = entities[offset + 9];
  const screenX = x * scaleX;
  const screenY = y * scaleY;
  const prevX = (x - velocityX * 0.026) * scaleX;
  const prevY = (y - velocityY * 0.026) * scaleY;
  const radius = Math.max(1, size * Math.min(scaleX, scaleY));
  const color = colorFor(hue + state.hueShift, kind === 1 ? 63 : 55);

  context.globalAlpha = alpha * 0.38;
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, radius * (kind === 1 ? 0.75 : 0.45));
  context.beginPath();
  context.moveTo(prevX, prevY);
  context.lineTo(screenX, screenY);
  context.stroke();

  context.globalAlpha = alpha * 0.18;
  context.fillStyle = color;
  context.beginPath();
  context.arc(screenX, screenY, radius * (kind === 1 ? 2.75 : 1.9) * (0.6 + energy), 0, Math.PI * 2);
  context.fill();

  context.globalAlpha = alpha;
  context.beginPath();
  if (kind === 1) {
    context.arc(screenX, screenY, radius * 0.65, 0, Math.PI * 2);
  } else {
    const directionX = screenX - prevX;
    const directionY = screenY - prevY;
    const directionLengthSquared = directionX * directionX + directionY * directionY;
    const inverseDirectionLength = directionLengthSquared > 0.0001 ? 1 / Math.sqrt(directionLengthSquared) : 1;
    const baseForwardX = directionLengthSquared > 0.0001 ? directionX * inverseDirectionLength : 1;
    const baseForwardY = directionLengthSquared > 0.0001 ? directionY * inverseDirectionLength : 0;
    const teamIndex = team & 3;
    const rotationCos = teamRotationCos[teamIndex];
    const rotationSin = teamRotationSin[teamIndex];
    const forwardX = baseForwardX * rotationCos - baseForwardY * rotationSin;
    const forwardY = baseForwardX * rotationSin + baseForwardY * rotationCos;
    const sideX = -forwardY;
    const sideY = forwardX;
    context.moveTo(screenX + forwardX * radius * 2.1, screenY + forwardY * radius * 2.1);
    context.lineTo(
      screenX - forwardX * radius * 1.15 + sideX * radius * 0.92,
      screenY - forwardY * radius * 1.15 + sideY * radius * 0.92,
    );
    context.lineTo(screenX - forwardX * radius * 0.58, screenY - forwardY * radius * 0.58);
    context.lineTo(
      screenX - forwardX * radius * 1.15 - sideX * radius * 0.92,
      screenY - forwardY * radius * 1.15 - sideY * radius * 0.92,
    );
    context.closePath();
  }
  context.fill();
  context.globalAlpha = alpha * 0.76;
  context.fillStyle = "rgb(255 252 226)";
  context.beginPath();
  context.arc(screenX, screenY, Math.max(0.8, radius * 0.38), 0, Math.PI * 2);
  context.fill();
};

/** @param {Float32Array} entities @param {number} offset @param {number} scaleX @param {number} scaleY */
const drawEntityMedium = (entities, offset, scaleX, scaleY) => {
  const velocityX = entities[offset + 2];
  const velocityY = entities[offset + 3];
  const x = entities[offset] * scaleX;
  const y = entities[offset + 1] * scaleY;
  const radius = Math.max(1.2, entities[offset + 5] * Math.min(scaleX, scaleY));
  const alpha = entities[offset + 6];
  const color = colorFor(entities[offset + 4] + state.hueShift, entities[offset + 9] === 1 ? 63 : 55);

  context.globalAlpha = alpha * 0.34;
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, radius * 0.4);
  context.beginPath();
  context.moveTo(x - velocityX * 0.022 * scaleX, y - velocityY * 0.022 * scaleY);
  context.lineTo(x, y);
  context.stroke();

  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, radius * 0.72, 0, Math.PI * 2);
  context.fill();
};

/** @param {Float32Array} entities @param {number} maxOffset @param {number} stride @param {number} scaleX @param {number} scaleY @param {number} hueShift @param {boolean} useRects */
const drawBatchedDots = (entities, maxOffset, stride, scaleX, scaleY, hueShift, useRects) => {
  fillBuckets(entities, maxOffset, stride, hueShift);
  const scale = Math.min(scaleX, scaleY);
  for (let b = 0; b < COLOR_BUCKETS; b++) {
    const start = bucketStarts[b];
    const end = start + bucketCounts[b];
    if (start === end) continue;
    const sampleOffset = bucketOffsets[start];
    const sampleHue = entities[sampleOffset + 4] + hueShift;
    context.fillStyle = colorFor(sampleHue, 56);
    context.beginPath();
    for (let i = start; i < end; i++) {
      const offset = bucketOffsets[i];
      const x = entities[offset] * scaleX;
      const y = entities[offset + 1] * scaleY;
      const radius = Math.max(useRects ? 1.1 : 1.4, entities[offset + 5] * scale * (useRects ? 0.55 : 0.7));
      if (useRects) {
        const size = radius * 2;
        context.rect(x - radius, y - radius, size, size);
      } else {
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    context.globalAlpha = 0.82;
    context.fill();
  }
  context.globalAlpha = 1;
};

/** @param {Float32Array} entities @param {number} maxOffset @param {number} stride @param {number} scaleX @param {number} scaleY @param {number} hueShift */
const drawBatchedPoints = (entities, maxOffset, stride, scaleX, scaleY, hueShift) => {
  fillBuckets(entities, maxOffset, stride, hueShift);
  for (let b = 0; b < COLOR_BUCKETS; b++) {
    const start = bucketStarts[b];
    const end = start + bucketCounts[b];
    if (start === end) continue;
    const sampleOffset = bucketOffsets[start];
    context.fillStyle = colorFor(entities[sampleOffset + 4] + hueShift, 58);
    context.beginPath();
    for (let i = start; i < end; i++) {
      const offset = bucketOffsets[i];
      const x = entities[offset] * scaleX;
      const y = entities[offset + 1] * scaleY;
      const size = Math.max(1.5, entities[offset + 5] * Math.min(scaleX, scaleY) * 0.9);
      context.rect(x - size * 0.5, y - size * 0.5, size, size);
    }
    context.globalAlpha = 0.85;
    context.fill();
  }
  context.globalAlpha = 1;
};

/** @param {number} timeStamp */
const render = (timeStamp) => {
  const frameStarted = performance.now();
  const width = innerWidth;
  const height = innerHeight;
  const time = timeStamp / 1000;
  state.hueShift = Math.sin(time * 0.05) * 3;
  const scale = Math.min(width / state.worldWidth, height / state.worldHeight) * 1.08;
  const scaleX = scale;
  const scaleY = scale;
  const offsetX = (width - state.worldWidth * scale) * 0.5;
  const offsetY = (height - state.worldHeight * scale) * 0.5;

  clearStage(width, height);
  context.save();
  context.translate(offsetX, offsetY);
  drawPulse(scaleX, scaleY);
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  const entities = buildInterpolatedEntities(timeStamp);
  const maxOffset = Math.min(entities.length, state.renderBudget * state.stride);
  const count = maxOffset / state.stride;
  const detail = detailLevel(count);

  if (detail === 0) {
    drawBatchedPoints(entities, maxOffset, state.stride, scaleX, scaleY, state.hueShift);
  } else if (detail === 1) {
    drawBatchedDots(entities, maxOffset, state.stride, scaleX, scaleY, state.hueShift, true);
  } else if (detail === 2) {
    for (let offset = 0; offset < maxOffset; offset += state.stride) {
      drawEntityMedium(entities, offset, scaleX, scaleY);
    }
    context.globalAlpha = 1;
  } else {
    updateTeamRotations(time);
    for (let offset = 0; offset < maxOffset; offset += state.stride) {
      drawEntityFull(entities, offset, scaleX, scaleY);
    }
    context.globalAlpha = 1;
  }
  context.restore();

  state.drawMs = performance.now() - frameStarted;
  if ((timeStamp / 250 | 0) !== ((timeStamp - 16) / 250 | 0)) {
    ids.draw.textContent = state.drawMs.toFixed(1) + "ms";
  }

  requestAnimationFrame(render);
};

addEventListener("resize", resize);
canvas.addEventListener("pointerdown", (event) => {
  const scale = Math.min(innerWidth / state.worldWidth, innerHeight / state.worldHeight) * 1.08;
  const x = (event.clientX - (innerWidth - state.worldWidth * scale) * 0.5) / scale;
  const y = (event.clientY - (innerHeight - state.worldHeight * scale) * 0.5) / scale;
  command({ action: "burst", x, y, hue: 184 + Math.random() * 68 });
});

document.querySelectorAll("button[data-mode]").forEach((button) => {
  button.addEventListener("click", () =>
    (() => {
      const mode = button instanceof HTMLButtonElement ? button.dataset.mode : undefined;
      if (mode === "orbit" || mode === "storm" || mode === "lattice") command({ action: "mode", mode });
    })());
});
requireElement("#intensity", HTMLInputElement).addEventListener("input", (event) => {
  scheduleIntensityCommand(Number(event.target instanceof HTMLInputElement ? event.target.value : "0"));
});
ids.droneControl.addEventListener("input", (event) => {
  ids.droneTarget.textContent = event.target instanceof HTMLInputElement ? event.target.value : "0";
});
ids.droneControl.addEventListener("change", (event) => {
  command({ action: "drones", value: Number(event.target instanceof HTMLInputElement ? event.target.value : "0") });
});
ids.renderControl.addEventListener("input", (event) => {
  ids.renderTarget.textContent = event.target instanceof HTMLInputElement ? event.target.value : "0";
});
ids.renderControl.addEventListener("change", (event) => {
  command({ action: "rendered", value: Number(event.target instanceof HTMLInputElement ? event.target.value : "0") });
});
requireElement("#burst", HTMLButtonElement).addEventListener("click", () => {
  command({ action: "burst", x: 960, y: 540, hue: 184 + Math.random() * 68 });
});
requireElement("#toggle", HTMLButtonElement).addEventListener("click", () => command({ action: "toggle" }));
requireElement("#reset", HTMLButtonElement).addEventListener("click", () => command({ action: "reset" }));

resize();
stream();
requestAnimationFrame(render);
