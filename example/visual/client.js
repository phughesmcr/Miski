// @ts-check
/// <reference lib="dom" />

/** @typedef {import("./contracts.ts").DemoHello} DemoHello */
/** @typedef {import("./contracts.ts").DemoStatus} DemoStatus */
/** @typedef {import("./contracts.ts").DemoServerMessage} DemoServerMessage */
/** @typedef {import("./contracts.ts").DemoCommand} DemoCommand */
/** @typedef {import("./contracts.ts").DemoMode} DemoMode */

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
const glContext = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
if (glContext === null) {
  requireElement("#fallback", HTMLElement).hidden = false;
  throw new Error("WebGL2 is unavailable.");
}
/** @type {WebGL2RenderingContext} */
const gl = glContext;

// --- State ---------------------------------------------------------------------------------------

/** Floats per instance: [fromX, fromY, toX, toY] [hue, size, alpha, energy] [kind, team, glow, seed]. */
const INSTANCE_FLOATS = 12;
const QUAD_CORNERS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
const TRAIL_DECAY = /** @type {Record<DemoMode, number>} */ ({ orbit: 0.84, storm: 0.88, lattice: 0.76, flock: 0.86 });

const state = {
  /** @type {DemoHello} */
  hello: {
    type: "hello",
    width: 1920,
    height: 1080,
    capacity: 40960,
    minDrones: 256,
    maxDrones: 32768,
    droneStep: 256,
    headerBytes: 48,
    entityBytes: 16,
    positionScale: 32,
    snapshotHz: 30,
  },
  /** @type {DemoStatus | undefined} */
  status: undefined,
  /** @type {DemoMode} */
  mode: "orbit",
  connected: false,
  trails: true,
  forecast: true,
  instanceCount: 0,
  ghostCount: 0,
  /** Snapshot arrival time and smoothed spacing drive interpolation. */
  arrivedAt: 0,
  intervalMs: 1000 / 30,
  sequence: 0,
  pulse: new Float32Array(3),
  attract: new Float32Array(3),
  pixelRatio: 1,
  frames: 0,
  fpsWindowStart: performance.now(),
  fps: 0,
  bytesWindow: 0,
  linkMbps: 0,
};

// Per entity index (lower 16 bits of the handle): where it is drawn from/to, which snapshot saw it, and
// the full handle, so a reused slot never lerps from a dead entity's position.
let fromX = new Float32Array(0);
let fromY = new Float32Array(0);
let toX = new Float32Array(0);
let toY = new Float32Array(0);
let seenAt = new Uint32Array(0);
let handleAt = new Uint32Array(0);
let instances = new Float32Array(0);
let ghosts = new Float32Array(0);
let ghostIndices = new Uint16Array(0);

const allocateForCapacity = (/** @type {number} */ capacity) => {
  if (fromX.length === capacity) return;
  fromX = new Float32Array(capacity);
  fromY = new Float32Array(capacity);
  toX = new Float32Array(capacity);
  toY = new Float32Array(capacity);
  seenAt = new Uint32Array(capacity);
  handleAt = new Uint32Array(capacity);
  instances = new Float32Array(capacity * INSTANCE_FLOATS);
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, instances.byteLength, gl.DYNAMIC_DRAW);
};

// --- WebGL -------------------------------------------------------------------------------------

const HSL = /* glsl */ `
vec3 hsl(float h, float s, float l) {
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + h / 30.0, 12.0);
  float a = s * min(l, 1.0 - l);
  return l - a * max(min(min(k - 3.0, 9.0 - k), 1.0), -1.0);
}`;

const PARTICLE_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aPath;
layout(location = 2) in vec4 aLook;
layout(location = 3) in vec4 aMeta;
uniform vec2 uViewport;
uniform vec3 uView;
uniform float uT;
uniform float uGain;
out vec2 vLocal;
out vec3 vColor;
out float vAlpha;
out float vGlow;
out float vStretch;
out float vSpread;
${HSL}
void main() {
  vec2 world = mix(aPath.xy, aPath.zw, uT);
  vec2 delta = aPath.zw - aPath.xy;
  float travel = length(delta);
  vec2 forward = travel > 0.01 ? delta / travel : vec2(1.0, 0.0);
  vec2 side = vec2(-forward.y, forward.x);
  float spark = aMeta.x;
  float glow = aMeta.z;
  // Dense swarms draw smaller, dimmer sprites so heads do not merge into white.
  float radius = max(aLook.y * uView.x * (0.65 + 0.35 * uGain), 0.9);
  float spread = spark > 0.5 ? 2.4 : 2.2 + glow * 2.6;
  float stretch = 1.0 + min(travel * uView.x / radius * 0.22, 5.0);
  float along = aCorner.x > 0.0 ? aCorner.x : aCorner.x * stretch;
  vec2 offset = (forward * along + side * aCorner.y) * radius * spread;
  vec2 pixel = world * uView.x + uView.yz + offset;
  vec2 clip = pixel / uViewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = vec2(along, aCorner.y);
  vStretch = stretch;
  vSpread = spread;
  vGlow = glow;
  vec3 base = hsl(aLook.x, spark > 0.5 ? 0.95 : 0.85, spark > 0.5 ? 0.6 : 0.55);
  vColor = mix(base, vec3(1.0, 0.74, 0.36), glow * 0.8);
  vAlpha = aLook.z * (0.5 + aLook.w * 0.55) * (1.0 + glow * 0.9) * uGain;
}`;

const PARTICLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vColor;
in float vAlpha;
in float vGlow;
in float vStretch;
in float vSpread;
out vec4 outColor;
void main() {
  float tailX = vLocal.x > 0.0 ? vLocal.x : vLocal.x / vStretch;
  float edge = tailX * tailX + vLocal.y * vLocal.y;
  if (edge > 1.0) discard;
  float r = length(vLocal) * vSpread;
  float tail = sqrt(edge) * vSpread;
  float core = exp(-r * r * 2.4);
  float halo = exp(-tail * 1.7) * (0.28 + vGlow * 0.55);
  vec3 color = vColor * (core * 1.25 + halo) + vec3(1.0) * core * core * (0.18 + vGlow * 0.6);
  outColor = vec4(color * vAlpha * (1.0 - edge), 1.0);
}`;

const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FADE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPrevious;
uniform float uDecay;
out vec4 outColor;
void main() {
  vec3 previous = texture(uPrevious, vUv).rgb;
  outColor = vec4(max(previous * uDecay - 0.004, 0.0), 1.0);
}`;

const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uViewport;
uniform vec3 uView;
uniform vec2 uWorld;
uniform vec3 uPulse;
uniform vec3 uAttract;
uniform float uTime;
out vec4 outColor;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);
  vec2 world = (pixel - uView.yz) / uView.x;
  vec2 q = (pixel - 0.5 * uViewport) / uViewport.y;
  vec3 color = mix(vec3(0.008, 0.011, 0.02), vec3(0.03, 0.045, 0.07), exp(-dot(q, q) * 2.4));

  // Faint world grid every 4 flocking cells (192 units).
  vec2 inside = step(vec2(0.0), world) * step(world, uWorld);
  vec2 major = abs(fract(world / 192.0 - 0.5) - 0.5) * 192.0 * uView.x;
  float grid = (1.0 - smoothstep(0.0, 1.4, min(major.x, major.y))) * 0.022;
  color += vec3(0.45, 0.7, 0.85) * grid * inside.x * inside.y;

  // Pulse shockwave: same radius the simulation uses (60 + age * 470).
  if (uPulse.z > 0.0) {
    float radius = 60.0 + (1.0 - uPulse.z) * 1.8 * 470.0;
    float d = length(world - uPulse.xy);
    float ring = exp(-pow((d - radius) / 14.0, 2.0)) * uPulse.z;
    float echo = exp(-pow((d - radius * 0.64) / 5.0, 2.0)) * uPulse.z;
    color += vec3(0.45, 0.95, 0.9) * ring * 0.4 + vec3(1.0, 0.75, 0.36) * echo * 0.22;
  }

  // Gravity well (cyan) or repulsor (coral).
  if (uAttract.z != 0.0) {
    vec2 delta = world - uAttract.xy;
    float d = length(delta);
    float angle = atan(delta.y, delta.x);
    float swirl = 0.5 + 0.5 * sin(angle * 5.0 - d * 0.045 + uTime * 6.0 * sign(uAttract.z));
    vec3 tint = uAttract.z > 0.0 ? vec3(0.4, 0.9, 1.0) : vec3(1.0, 0.45, 0.35);
    color += tint * exp(-d / 160.0) * (0.1 + swirl * 0.16) + tint * exp(-pow((d - 26.0) / 3.0, 2.0)) * 0.6;
  }

  vec3 scene = texture(uScene, vUv).rgb;
  color += vec3(1.0) - exp(-scene * 1.15);
  color *= mix(0.55, 1.0, smoothstep(1.25, 0.25, length(q)));
  color += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * (1.6 / 255.0);
  outColor = vec4(color, 1.0);
}`;

const GHOST_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPoint;
uniform vec2 uViewport;
uniform vec3 uView;
uniform float uPixelRatio;
uniform float uLine;
out float vFraction;
out float vLine;
void main() {
  vec2 pixel = aPoint.xy * uView.x + uView.yz;
  vec2 clip = pixel / uViewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = (aPoint.z > 0.999 ? 5.0 : 2.6 - aPoint.z * 1.2) * uPixelRatio;
  vFraction = aPoint.z;
  vLine = uLine;
}`;

const GHOST_FS = /* glsl */ `#version 300 es
precision highp float;
in float vFraction;
in float vLine;
out vec4 outColor;
void main() {
  // Forecast paths are pink-white, a hue no team uses, fading into the future.
  vec3 color = mix(vec3(1.0, 0.85, 0.95), vec3(1.0, 0.35, 0.75), vFraction);
  float fade = 1.0 - vFraction * 0.65;
  if (vLine > 0.5) {
    outColor = vec4(color, 0.22 * fade);
    return;
  }
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float ring = vFraction > 0.999 ? smoothstep(0.35, 0.6, d) : 1.0;
  outColor = vec4(color, (1.0 - d * 0.7) * fade * ring * 0.8);
}`;

/** @param {number} type @param {string} source */
const compile = (type, source) => {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("Unable to create shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compile failed.");
  }
  return shader;
};

/**
 * @param {string} vertex
 * @param {string} fragment
 * @param {string[]} uniformNames
 */
const createProgram = (vertex, fragment, uniformNames) => {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Program link failed.");
  }
  /** @type {Record<string, WebGLUniformLocation | null>} */
  const uniforms = {};
  for (const name of uniformNames) uniforms[name] = gl.getUniformLocation(program, name);
  return { program, uniforms };
};

const particleProgram = createProgram(PARTICLE_VS, PARTICLE_FS, ["uViewport", "uView", "uT", "uGain"]);
const fadeProgram = createProgram(FULLSCREEN_VS, FADE_FS, ["uPrevious", "uDecay"]);
const compositeProgram = createProgram(FULLSCREEN_VS, COMPOSITE_FS, [
  "uScene",
  "uViewport",
  "uView",
  "uWorld",
  "uPulse",
  "uAttract",
  "uTime",
]);
const ghostProgram = createProgram(GHOST_VS, GHOST_FS, ["uViewport", "uView", "uPixelRatio", "uLine"]);

const quadBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.bufferData(gl.ARRAY_BUFFER, QUAD_CORNERS, gl.STATIC_DRAW);
const instanceBuffer = gl.createBuffer();
const ghostBuffer = gl.createBuffer();
const ghostIndexBuffer = gl.createBuffer();
let ghostLineIndices = 0;

const particleVao = gl.createVertexArray();
gl.bindVertexArray(particleVao);
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
for (let i = 0; i < 3; i++) {
  gl.enableVertexAttribArray(i + 1);
  gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, INSTANCE_FLOATS * 4, i * 16);
  gl.vertexAttribDivisor(i + 1, 1);
}

const ghostVao = gl.createVertexArray();
gl.bindVertexArray(ghostVao);
gl.bindBuffer(gl.ARRAY_BUFFER, ghostBuffer);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ghostIndexBuffer);

const emptyVao = gl.createVertexArray();
gl.bindVertexArray(null);

// Trails accumulate in a ping-pong pair of HDR targets when float rendering is available.
const floatTargets = gl.getExtension("EXT_color_buffer_float") !== null;
/** @type {{ texture: WebGLTexture, framebuffer: WebGLFramebuffer }[]} */
const targets = [];
let readTarget = 0;

const createTarget = (/** @type {number} */ width, /** @type {number} */ height) => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    floatTargets ? gl.RGBA16F : gl.RGBA8,
    width,
    height,
    0,
    gl.RGBA,
    floatTargets ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer };
};

const resize = () => {
  state.pixelRatio = Math.min(devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(innerWidth * state.pixelRatio));
  const height = Math.max(1, Math.floor(innerHeight * state.pixelRatio));
  if (canvas.width === width && canvas.height === height && targets.length === 2) return;
  canvas.width = width;
  canvas.height = height;
  for (const target of targets.splice(0)) {
    gl.deleteTexture(target.texture);
    gl.deleteFramebuffer(target.framebuffer);
  }
  targets.push(createTarget(width, height), createTarget(width, height));
};

/** World-to-framebuffer transform: [scale, offsetX, offsetY]. Slight overscan crops the bounce margins. */
const view = new Float32Array(3);
const updateView = () => {
  const { width, height } = state.hello;
  const scale = Math.min(canvas.width / width, canvas.height / height) * 1.06;
  view[0] = scale;
  view[1] = (canvas.width - width * scale) * 0.5;
  view[2] = (canvas.height - height * scale) * 0.5;
};

/** @param {number} clientX @param {number} clientY */
const toWorld = (clientX, clientY) => {
  updateView();
  return {
    x: (clientX * state.pixelRatio - view[1]) / view[0],
    y: (clientY * state.pixelRatio - view[2]) / view[0],
  };
};

// --- Snapshots ---------------------------------------------------------------------------------

/** @param {ArrayBuffer} buffer */
const ingestFrame = (buffer) => {
  const { headerBytes, entityBytes, positionScale, capacity } = state.hello;
  const header = new DataView(buffer, 0, headerBytes);
  if (header.getUint32(0, true) !== 0x314b534d) return;
  const count = header.getUint32(8, true);
  const ghostEntities = header.getUint32(12, true);
  const ghostSamples = header.getUint32(16, true);
  state.pulse[0] = header.getFloat32(20, true);
  state.pulse[1] = header.getFloat32(24, true);
  state.pulse[2] = header.getFloat32(28, true);
  state.attract[0] = header.getFloat32(32, true);
  state.attract[1] = header.getFloat32(36, true);
  state.attract[2] = header.getFloat32(40, true);
  allocateForCapacity(capacity);

  const now = performance.now();
  if (state.arrivedAt > 0) {
    const gap = Math.min(250, now - state.arrivedAt);
    state.intervalMs += (gap - state.intervalMs) * 0.2;
  }
  // Start each entity from where it is drawn right now, so late or early frames never snap.
  const shownT = state.arrivedAt > 0 ? Math.min(1, (now - state.arrivedAt) / (state.intervalMs * 1.15)) : 1;
  state.arrivedAt = now;
  const previous = state.sequence;
  const sequence = ++state.sequence;

  const words = new Uint32Array(buffer, headerBytes, count * (entityBytes >> 2));
  const halves = new Uint16Array(buffer, headerBytes, count * (entityBytes >> 1));
  const bytes = new Uint8Array(buffer, headerBytes, count * entityBytes);
  const inverseScale = 1 / positionScale;
  const out = instances;
  for (let i = 0; i < count; i++) {
    const handle = words[i * (entityBytes >> 2)];
    const index = handle & 0xffff;
    const half = i * (entityBytes >> 1);
    const byte = i * entityBytes;
    const x = halves[half + 2] * inverseScale;
    const y = halves[half + 3] * inverseScale;
    let startX = x;
    let startY = y;
    if (seenAt[index] === previous && handleAt[index] === handle) {
      startX = fromX[index] + (toX[index] - fromX[index]) * shownT;
      startY = fromY[index] + (toY[index] - fromY[index]) * shownT;
    }
    fromX[index] = startX;
    fromY[index] = startY;
    toX[index] = x;
    toY[index] = y;
    seenAt[index] = sequence;
    handleAt[index] = handle;

    const o = i * INSTANCE_FLOATS;
    out[o] = startX;
    out[o + 1] = startY;
    out[o + 2] = x;
    out[o + 3] = y;
    out[o + 4] = bytes[byte + 8] * (360 / 256);
    out[o + 5] = bytes[byte + 9] / 16;
    out[o + 6] = bytes[byte + 10] / 255;
    out[o + 7] = bytes[byte + 11] / 196;
    out[o + 8] = bytes[byte + 12];
    out[o + 9] = bytes[byte + 13];
    out[o + 10] = bytes[byte + 14] / 255;
    out[o + 11] = index;
  }
  state.instanceCount = count;
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, out, 0, count * INSTANCE_FLOATS);

  const ghostPoints = ghostEntities * ghostSamples;
  state.ghostCount = ghostPoints;
  if (ghostPoints > 0) {
    const paths = new Uint16Array(buffer, headerBytes + count * entityBytes, ghostPoints * 2);
    if (ghosts.length < ghostPoints * 3) ghosts = new Float32Array(ghostPoints * 3);
    for (let i = 0; i < ghostPoints; i++) {
      ghosts[i * 3] = paths[i * 2] * inverseScale;
      ghosts[i * 3 + 1] = paths[i * 2 + 1] * inverseScale;
      ghosts[i * 3 + 2] = ((i % ghostSamples) + 1) / ghostSamples;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, ghostBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ghosts.subarray(0, ghostPoints * 3), gl.STREAM_DRAW);
    // Join consecutive samples of each path into line segments.
    const segments = ghostEntities * (ghostSamples - 1);
    if (ghostIndices.length < segments * 2) ghostIndices = new Uint16Array(segments * 2);
    let cursor = 0;
    for (let e = 0; e < ghostEntities; e++) {
      for (let k = 0; k < ghostSamples - 1; k++) {
        ghostIndices[cursor++] = e * ghostSamples + k;
        ghostIndices[cursor++] = e * ghostSamples + k + 1;
      }
    }
    ghostLineIndices = cursor;
    gl.bindVertexArray(ghostVao);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ghostIndices.subarray(0, cursor), gl.STREAM_DRAW);
    gl.bindVertexArray(null);
  }
  state.bytesWindow += buffer.byteLength;
};

// --- Rendering ---------------------------------------------------------------------------------

/** @param {number} timeStamp */
const render = (timeStamp) => {
  resize();
  updateView();
  const width = canvas.width;
  const height = canvas.height;
  const write = targets[readTarget ^ 1];
  const read = targets[readTarget];
  const t = state.arrivedAt > 0 ? Math.min(1, (performance.now() - state.arrivedAt) / (state.intervalMs * 1.15)) : 1;

  gl.viewport(0, 0, width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
  gl.disable(gl.BLEND);
  gl.useProgram(fadeProgram.program);
  gl.bindVertexArray(emptyVao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, read.texture);
  gl.uniform1i(fadeProgram.uniforms.uPrevious, 0);
  gl.uniform1f(fadeProgram.uniforms.uDecay, state.trails ? TRAIL_DECAY[state.mode] : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  if (state.instanceCount > 0) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(particleProgram.program);
    gl.uniform2f(particleProgram.uniforms.uViewport, width, height);
    gl.uniform3fv(particleProgram.uniforms.uView, view);
    gl.uniform1f(particleProgram.uniforms.uT, t);
    // Additive blending saturates as the swarm grows; dim each particle so 32k reads like 2k.
    gl.uniform1f(particleProgram.uniforms.uGain, Math.min(1, Math.max(0.3, (2500 / state.instanceCount) ** 0.45)));
    gl.bindVertexArray(particleVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, state.instanceCount);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.disable(gl.BLEND);
  gl.useProgram(compositeProgram.program);
  gl.bindVertexArray(emptyVao);
  gl.bindTexture(gl.TEXTURE_2D, write.texture);
  gl.uniform1i(compositeProgram.uniforms.uScene, 0);
  gl.uniform2f(compositeProgram.uniforms.uViewport, width, height);
  gl.uniform3fv(compositeProgram.uniforms.uView, view);
  gl.uniform2f(compositeProgram.uniforms.uWorld, state.hello.width, state.hello.height);
  gl.uniform3fv(compositeProgram.uniforms.uPulse, state.pulse);
  gl.uniform3fv(compositeProgram.uniforms.uAttract, state.attract);
  gl.uniform1f(compositeProgram.uniforms.uTime, timeStamp / 1000);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  if (state.forecast && state.ghostCount > 0) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(ghostProgram.program);
    gl.uniform2f(ghostProgram.uniforms.uViewport, width, height);
    gl.uniform3fv(ghostProgram.uniforms.uView, view);
    gl.uniform1f(ghostProgram.uniforms.uPixelRatio, state.pixelRatio);
    gl.bindVertexArray(ghostVao);
    gl.uniform1f(ghostProgram.uniforms.uLine, 1);
    gl.drawElements(gl.LINES, ghostLineIndices, gl.UNSIGNED_SHORT, 0);
    gl.uniform1f(ghostProgram.uniforms.uLine, 0);
    gl.drawArrays(gl.POINTS, 0, state.ghostCount);
  }
  gl.bindVertexArray(null);
  readTarget ^= 1;

  state.frames++;
  requestAnimationFrame(render);
};

// --- HUD -------------------------------------------------------------------------------------

const hud = {
  link: requireElement("#link", HTMLElement),
  entities: requireElement("#entities", HTMLElement),
  drones: requireElement("#drones", HTMLElement),
  sparks: requireElement("#sparks", HTMLElement),
  charged: requireElement("#charged", HTMLElement),
  chargedBar: requireElement("#chargedBar", HTMLElement),
  ignited: requireElement("#ignited", HTMLElement),
  spent: requireElement("#spent", HTMLElement),
  tick: requireElement("#tick", HTMLElement),
  fps: requireElement("#fps", HTMLElement),
  forecast: requireElement("#forecastCost", HTMLElement),
  drift: requireElement("#drift", HTMLElement),
  bandwidth: requireElement("#bandwidth", HTMLElement),
  heap: requireElement("#heap", HTMLElement),
  droneTarget: requireElement("#droneTarget", HTMLOutputElement),
  droneControl: requireElement("#droneControl", HTMLInputElement),
  intensity: requireElement("#intensity", HTMLInputElement),
  contagion: requireElement("#contagion", HTMLInputElement),
  toggle: requireElement("#toggle", HTMLButtonElement),
  forecastToggle: requireElement("#forecastToggle", HTMLButtonElement),
  trailsToggle: requireElement("#trailsToggle", HTMLButtonElement),
};
const numberFormat = new Intl.NumberFormat("en");

const updateHud = () => {
  const now = performance.now();
  const seconds = (now - state.fpsWindowStart) / 1000;
  if (seconds >= 0.5) {
    state.fps = state.frames / seconds;
    state.linkMbps = state.bytesWindow / seconds / 1_048_576;
    state.frames = 0;
    state.bytesWindow = 0;
    state.fpsWindowStart = now;
  }
  hud.link.dataset.state = state.connected ? "live" : "offline";
  hud.link.textContent = state.connected ? "live" : "offline";
  hud.fps.textContent = state.fps.toFixed(0);
  hud.bandwidth.textContent = state.linkMbps.toFixed(1) + " MB/s";
  const status = state.status;
  if (!status) return;
  const m = status.metrics;
  hud.entities.textContent = numberFormat.format(m.active) + " / " + numberFormat.format(m.capacity);
  hud.drones.textContent = numberFormat.format(m.drones);
  hud.sparks.textContent = numberFormat.format(m.sparks);
  hud.charged.textContent = numberFormat.format(m.charged);
  hud.chargedBar.style.setProperty("--fill", String(m.drones > 0 ? m.charged / m.drones : 0));
  hud.ignited.textContent = numberFormat.format(m.ignitedPerSec);
  hud.spent.textContent = numberFormat.format(m.spentPerSec);
  hud.tick.textContent = m.tickMs.toFixed(2) + " ms";
  hud.heap.textContent = m.heapMb.toFixed(1) + " MB";
  hud.forecast.textContent = status.forecast ? m.forecastSteps + " steps · " + m.forecastMs.toFixed(1) + " ms" : "off";
  hud.drift.dataset.state = !status.forecast ?
    "off" :
    m.forecastDrift === null ?
    "disturbed" :
    m.forecastDrift === 0 ?
    "exact" :
    "drift";
  hud.drift.textContent = !status.forecast ?
    "off" :
    m.forecastDrift === null ?
    "input changed it" :
    m.forecastDrift === 0 ?
    "0 px · exact" :
    m.forecastDrift.toFixed(3) + " px";
  if (document.activeElement !== hud.droneControl) {
    hud.droneControl.value = String(m.droneTarget);
    hud.droneTarget.value = numberFormat.format(m.droneTarget);
  }
  if (document.activeElement !== hud.intensity) hud.intensity.value = String(status.intensity);
  if (document.activeElement !== hud.contagion) hud.contagion.value = String(status.contagion);
  hud.toggle.textContent = status.running ? "Pause" : "Resume";
  hud.forecastToggle.setAttribute("aria-pressed", String(status.forecast));
  hud.trailsToggle.setAttribute("aria-pressed", String(state.trails));
  for (const button of document.querySelectorAll("button[data-mode]")) {
    if (button instanceof HTMLButtonElement) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === status.mode));
    }
  }
};

// --- Network ---------------------------------------------------------------------------------

/** @type {WebSocket | undefined} */
let socket;

/** @param {DemoCommand} payload */
const command = (payload) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
};

const connect = () => {
  const url = new URL("/ws", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  socket = ws;
  ws.addEventListener("open", () => {
    state.connected = true;
    updateHud();
  });
  ws.addEventListener("close", () => {
    state.connected = false;
    state.arrivedAt = 0;
    updateHud();
    setTimeout(connect, 1000);
  });
  ws.addEventListener("message", (event) => {
    if (event.data instanceof ArrayBuffer) {
      ingestFrame(event.data);
      return;
    }
    const message = /** @type {DemoServerMessage} */ (JSON.parse(String(event.data)));
    if (message.type === "hello") {
      state.hello = message;
      state.intervalMs = 1000 / message.snapshotHz;
      hud.droneControl.min = String(message.minDrones);
      hud.droneControl.max = String(message.maxDrones);
      hud.droneControl.step = String(message.droneStep);
      allocateForCapacity(message.capacity);
    } else {
      state.status = message;
      state.mode = message.mode;
      state.forecast = message.forecast;
      updateHud();
    }
  });
};

// --- Input -----------------------------------------------------------------------------------

const HOLD_MS = 180;
/** @type {{ id: number, x: number, y: number, at: number, strength: number, holding: boolean } | undefined} */
let press;
let holdTimer = 0;
let attractFrame = 0;
/** @type {{ x: number, y: number }} */
let attractTarget = { x: 0, y: 0 };

const sendAttract = () => {
  attractFrame = 0;
  if (press?.holding) command({ action: "attract", ...attractTarget, strength: press.strength });
};

canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  const repel = event.button === 2 || event.shiftKey || event.altKey;
  press = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    at: performance.now(),
    strength: repel ? -1 : 1,
    holding: false,
  };
  attractTarget = toWorld(event.clientX, event.clientY);
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    if (!press) return;
    press.holding = true;
    canvas.dataset.holding = press.strength > 0 ? "attract" : "repel";
    sendAttract();
  }, HOLD_MS);
});
canvas.addEventListener("pointermove", (event) => {
  if (!press || press.id !== event.pointerId) return;
  attractTarget = toWorld(event.clientX, event.clientY);
  if (press.holding && attractFrame === 0) attractFrame = requestAnimationFrame(sendAttract);
});
const endPress = (/** @type {PointerEvent} */ event) => {
  if (!press || press.id !== event.pointerId) return;
  clearTimeout(holdTimer);
  if (press.holding) {
    command({ action: "attract", ...attractTarget, strength: 0 });
  } else if (event.type === "pointerup") {
    const point = toWorld(event.clientX, event.clientY);
    command({ action: "burst", x: point.x, y: point.y, hue: 170 + Math.random() * 90 });
  }
  delete canvas.dataset.holding;
  press = undefined;
};
canvas.addEventListener("pointerup", endPress);
canvas.addEventListener("pointercancel", endPress);

for (const button of document.querySelectorAll("button[data-mode]")) {
  button.addEventListener("click", () => {
    const mode = button instanceof HTMLButtonElement ? button.dataset.mode : undefined;
    if (mode === "orbit" || mode === "storm" || mode === "lattice" || mode === "flock") {
      command({ action: "mode", mode });
    }
  });
}

/** @param {HTMLInputElement} input @param {(value: number) => void} send */
const throttledSlider = (input, send) => {
  let frame = 0;
  input.addEventListener("input", () => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      send(Number(input.value));
    });
  });
};
throttledSlider(hud.intensity, (value) => command({ action: "intensity", value }));
throttledSlider(hud.contagion, (value) => command({ action: "contagion", value }));
hud.droneControl.addEventListener("input", () => {
  hud.droneTarget.value = numberFormat.format(Number(hud.droneControl.value));
});
hud.droneControl.addEventListener("change", () => command({ action: "drones", value: Number(hud.droneControl.value) }));

const pulseCenter = () =>
  command({ action: "burst", x: state.hello.width / 2, y: state.hello.height / 2, hue: 170 + Math.random() * 90 });
const toggleForecast = () => command({ action: "forecast", enabled: !state.forecast });
const toggleTrails = () => {
  state.trails = !state.trails;
  updateHud();
};
requireElement("#burst", HTMLButtonElement).addEventListener("click", pulseCenter);
hud.toggle.addEventListener("click", () => command({ action: "toggle" }));
hud.forecastToggle.addEventListener("click", toggleForecast);
hud.trailsToggle.addEventListener("click", toggleTrails);
requireElement("#reset", HTMLButtonElement).addEventListener("click", () => command({ action: "reset" }));

/** @type {Record<string, () => void>} */
const shortcuts = {
  "1": () => command({ action: "mode", mode: "orbit" }),
  "2": () => command({ action: "mode", mode: "storm" }),
  "3": () => command({ action: "mode", mode: "lattice" }),
  "4": () => command({ action: "mode", mode: "flock" }),
  " ": () => command({ action: "toggle" }),
  "f": toggleForecast,
  "t": toggleTrails,
  "p": pulseCenter,
  "r": () => command({ action: "reset" }),
  "h": () => document.body.classList.toggle("hide-ui"),
};
addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
  const action = shortcuts[event.key.toLowerCase()];
  if (!action) return;
  if (event.target instanceof HTMLButtonElement && event.key === " ") return;
  event.preventDefault();
  action();
});

addEventListener("resize", resize);
setInterval(updateHud, 500);
resize();
connect();
requestAnimationFrame(render);
