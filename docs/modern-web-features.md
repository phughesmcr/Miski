# Modern JS / web platform features for Miski

Research report. Written 2026-11 against branch `1.0.0-alpha` (`deno.json` 1.0.0-beta.2; README targets Deno ^2.9.7,
Node ^24, Bun ^1.3; `lib: ["esnext","dom"]`, `erasableSyntaxOnly: true`). Revised after seven follow-up explorations,
each of which prototyped or benchmarked its topic (Deno 2.9.8 / V8 15.0 on aarch64 macOS unless stated). Their full
notes (diffs, bench tables, sources) are in the side-session notes folder of the session that commissioned this report:
`small-apis.md`, `disposables.md` (+ two `.patch` files), `float16.md`, `buffers.md`, `async-context.md`,
`task-scheduling.md`, `workers-sab.md`.

Sources: GoogleChrome/modern-web-guidance-src (`guides/js/js/guide.md`, `guides/performance/{schedule-tasks-by-priority,
break-up-long-tasks}`), TC39 proposal repos, `@mdn/browser-compat-data` 8.1.9, chromestatus, V8 source, and local
runtime checks (Deno 2.9.8, Node 26, Bun 1.4.4). Node 24.0 and Bun 1.3 floors were not installed, so their versions come
from BCD, not local runs. Anything still unconfirmed is marked `(verify)`.

The guidance repo covers `structuredClone`, copying array methods, `Object/Map.groupBy`, `Promise.withResolvers`,
`AbortSignal.timeout/any`, base64/hex, `scheduler.postTask` / `scheduler.yield`, Temporal and workers/Wasm. It says
nothing about `using`, `Float16Array`, resizable buffers, iterator helpers or `AsyncContext`.

Key constraint: hot paths are zero-allocation and GC-budgeted (`deno task bench:gc`). Anything that allocates per call
is out of the hot path, and column storage changes go through `@phughesmcr/partitionedbuffer`.

## Ranked table

| # | Feature | Where in Miski | Finding | Support | Recommendation |
|---|---|---|---|---|---|
| 1 | `Error.isError` | `command-buffer.ts:687` (the only `instanceof Error` in `src/`) | Cross-realm and `DOMException` safe. Applied in a prototype; suite green | Chrome 134, Node 24.3, Deno 2.2, Bun 1.1.39. **Node 24.0–24.2 lack it** → module-level `typeof` fallback | **Adopted** |
| 2 | `Promise.withResolvers` | `world.ts:352` `#initPromise` + `#initResolver` (only hand-rolled one) | Becomes one `#init` field; `?.` calls on the resolver go. Prototype green | Chrome 119, Node 22, Deno 1.38, Bun 1.0 | **Adopted** |
| 3 | `World[Symbol.asyncDispose]` | `world.ts` `destroy()` | `await using world` tears down on scope exit. Designed against the now-idempotent `destroy()` | Chrome 134, Node 24.0, Deno 2.2.10, Bun 1.3.0; Safari (verify) | **Adopted** |
| 4 | Disposable rollback scope (`using`) | `src/rollback/rollback.ts` | Real hazard: an open rollback scope blocks every later capture ("already active") and loads (`assertLoadReady`), so one leaked by a throw wedges the world | as #3 | **Adopted** (`WorldRollbackScope`) |
| 5 | `Float16Array` columns | `component.ts:21-35`, `schema.ts:22`, `serialization/format.ts` | Feasible and small. f16 within 0–25% of f32 speed on aarch64. Saves without f16 stay byte-identical | Chrome 135, Node 24.0, Deno, Bun 1.1.23 (BCD summary, verify); TS 6.0.3 types it | **Adopted** with partitionedbuffer 0.5.0 |
| 6 | `scheduler.yield` / `postTask` | `src/scheduler/schedule.ts` | Docs recipe now; opt-in yielding adapter only if frames can exceed 50 ms. Determinism preserved in prototype | `yield`: Chrome 129, Firefox 142, no Safari. `postTask`: Chrome 94, Firefox 101 (verify) | **Docs adopted** (README recipe), adapter later |
| 7 | `AsyncContext` | `src/system/hook-scope.ts` | Stage 2. Not in Chrome (no flag, no origin trial found), not in Deno 2.9.8. Polyfill not viable | none | **Later**: feature-detected backend when it ships |
| 8 | Workers + `SharedArrayBuffer` | partitionedbuffer, `scheduler/order.ts` | partitionedbuffer can't back a SAB today. Best-case crossover ≈ 2–3e4 entities (realistically ≥ 5e4); 3.9× at 4e6 with 4 workers | Chrome with cross-origin isolation | **Later**, optional module outside core |
| 9 | `Map.getOrInsert[Computed]` | `archetype.ts:329`, `archetype-manager.ts:208`, `command-buffer.ts:462,655`, `prefab-spawner.ts:175`, `query-manager.ts:225`, `world-save.ts:110` | Every site builds a non-trivial value or would add a closure allocation | Chrome 145, Deno 2.6.7, Bun 1.2.20, **Node 26.0** | **Later**: no measurable gain; revisit at Node floor 26 |
| 10 | `Uint8Array` `toBase64` / `toHex` | none (`hashHex`/`fnv1a64` format numbers/BigInt, not bytes) | Users can already call `saveWorld(...).toBase64()` | Chrome 140, Deno 2.5, Bun 1.1.22, **Node 25.0** | **Later**: no call site; reconsider a helper at Node floor 25 |
| 11 | Resizable `ArrayBuffer` / growable SAB | `utils.ts:70`, `relation-store.ts:201-208`, `archetype.ts` `#reserve`, `relation-list.ts:50`, `component-manager.ts` `#allocateList` | Views over resizable buffers are **4–7× slower** per element (growable SAB 20–40×). Prototype: queries unchanged, relation lookups 11–27% slower, no growth gain (doubling already amortizes) | Baseline 2024 | **No** |
| 12 | `ArrayBuffer.prototype.transfer` | growth sites; worker handoff | V8 does not realloc in place: same cost as alloc+copy. Detach breaks users holding `partitions[key]` across a grow | Baseline 2024 | **No** (maybe an opt-in stale-view debug check) |
| 13 | `Promise.try` | `system-manager.ts` `#runHook`, `#initLateRecord` | Hook runners rely on sync throws, synchronous `end()` and `isPromiseLike` branching; no call site simplifies | Chrome 128 | **No** |
| 14 | `using` on checkpoints | `checkpoint.ts`, `world.ts` `captureCheckpoint` | A checkpoint is frozen, reusable data that owns nothing | - | **No** |
| 15 | `using` on CommandBuffer / Schedule / query pools / prefab spawners | `scheduler/**`, `query-pool.ts`, `prefab-spawner.ts` | CommandBuffer dispose must pick flush or discard, both hide bugs; the rest own nothing | - | **No** |
| 16 | `using` in hot paths | anywhere | Allocates even on pooled objects: 5M iterations 385 ms / 1030 GC events vs try/finally 6 ms / 4 | - | **No** |
| 17 | Iterator helpers | `query-iterators.ts:87`, `relation-list.ts:107`, `entity.ts:182,224` | Allocate wrappers; Miski's reusable iterators already avoid that | Chrome 122 | **No** in `src/`; fine in examples |
| 18 | `structuredClone` | object fields, prefabs | Miski already has `clone`/`encode`/`decode` hooks; clone drops prototypes | everywhere | **No** |
| 19 | `Atomics.pause` / `Atomics.waitAsync` | none today | Only relevant inside #8 (Chrome's main thread can't `Atomics.wait`, so joins need `waitAsync`) | Chrome 133 / 87 | **No** (part of #8) |
| 20 | `Math.sumPrecise`, `RegExp.escape`, import attributes, Web Locks, OffscreenCanvas | none | No call site | - | **No** |
| 21 | Records/tuples, decorators | - | Records/tuples withdrawn; decorators not shipped natively and not erasable TS | none | **No** |

## Adopt now, ordered by value per effort

1. **`Error.isError`** (minutes): one line plus a fallback for Node 24.0–24.2.
2. **`Promise.withResolvers` in the `World` constructor** (minutes, zero risk).
3. **`scheduler.yield` docs recipe** (docs only, no code).
4. **`World[Symbol.asyncDispose]`** (small, additive).
5. **Disposable rollback scope** (new public API and about 15 tests, but it fixes a real wedge).

Prototypes for 1 and 2 exist uncommitted in worktree `agent-a6ba9562fbd8ace4a`. Patches for 4 and 5 are in the notes
folder (`disposables-world-prototype.patch`, `disposables-prototype.patch`).

`World.destroy()` was made idempotent alongside this report: it is a no-op on a destroyed world. A call while teardown
is running still rejects "World is being destroyed": Miski no longer uses async context tracking, so it can't be told
apart from a destroy hook calling `destroy()` after an `await`, which would wait on itself.

### 1. `Error.isError` (`command-buffer.ts:687`)

```ts
const isError: (value: unknown) => value is Error =
  typeof Error.isError === "function" ? Error.isError : (value): value is Error => value instanceof Error;
// ...
if (!isError(error) || record >= this.#recordCount) return;
```

Keep the `MiskiError` / `RangeError` checks elsewhere as they are; they test specific classes. Drop the fallback once
the Node floor is 24.3.

### 2. `Promise.withResolvers` (`world.ts:352`)

```ts
readonly #init: PromiseWithResolvers<WorldState> = Promise.withResolvers<WorldState>(); // existing resolver type
// constructor: remove the `new Promise` block; callers use this.#init.promise / this.#init.resolve(...)
```

Same pattern as `#teardownStarted` at `world.ts:118`.

### 3. `scheduler.yield` recipe (README / docs)

```ts
const yieldToMain = globalThis.scheduler?.yield?.bind(globalThis.scheduler) ??
  (() => new Promise<void>((r) => setTimeout(r, 0)));
for (;;) {
  schedule.run(dt);
  await yieldToMain(); // between frames, never inside a system
}
```

Background work (analytics, saves to IndexedDB) goes through `scheduler.postTask(fn, { priority: "background" })` on
data copied out of the world. Do **not** give systems `postTask` priorities: that reorders simulation work. Only if
single frames can exceed 50 ms, add an opt-in `runScheduleYielding` adapter. It needs `Schedule` split into
`begin/step/end/abort`, yields only at phase boundaries after the command flush, and must forbid save, rollback and
`setClock` while a frame is suspended. The prototype matched plain `run()` exactly with 26 yields/frame and cost about
100 B/frame when it never yields, plus about 150 B per actual yield. Rebuild `run()` on `begin/step` and check
`bench/scheduler.bench.ts` first.

### 4. `World[Symbol.asyncDispose]`

```ts
#disposal: Promise<void> | undefined;

[Symbol.asyncDispose](): Promise<void> {
  if (this.#state === "uninitialized" || this.#state === "destroyed") return Promise.resolve();
  this.#disposal ??= this.destroy().catch((error) => {
    this.#disposal = undefined; // an error-state world can be disposed again
    throw error;
  });
  return this.#disposal;
}
```

- `uninitialized` is a no-op, not a throw: throwing from a disposer would hide the scope body's real error inside a
  `SuppressedError`.
- Concurrent disposals share `#disposal`. Disposing while someone else's `destroy()` runs rejects "being destroyed",
  consistent with `destroy()`.

### 5. Disposable rollback scope (`src/rollback/rollback.ts`)

```ts
using scope = new WorldRollbackScope(world); // opens the world's rollback scope
simulate();
if (ok) scope.commit(); // otherwise scope exit restores
```

`WorldRollbackScope` has a sync `[Symbol.dispose]` and `commit()`, `restore()` and `isOpen`. Dispose restores if still
open, and just drops the captured state if the world is no longer `initialized`. Use it in user code at frame/turn granularity,
not per entity (see row 16).

## Later items: what has to happen first

- **Float16Array:** release partitionedbuffer with `Float16Array` in `TypedArray` / `TypedArrayConstructor`
  (`utils.ts:13-34`) and a `"Float16Array"` case (max 65504) in `isValidTypedArrayValue` (`utils.ts:144`). Bare
  `{ v: Float16Array }` already works at runtime (Miski does not accept `[Ctor, initial]` column tuples). Alignment is
  `max(BYTES_PER_ELEMENT, 8)`, so no layout change is needed. Then in Miski:
  - add it to `SUPPORTED_COLUMN_CONSTRUCTORS` and the error message (`component.ts:21-35,193`);
  - append `"f16"` to the hashed, append-only `CONSTRUCTOR_TAGS` (`schema.ts:22`);
  - in `serialization/format.ts`, add field type code 12 to `NUMERIC_FIELD_TYPES` (which also feeds `Views` and
    `column()`);
  - flip the "Float16 rejected" test (`test/component_storage_integrity.test.ts:150-180`).

  `FORMAT_VERSION` stays 1, and older Miski versions reject f16 saves cleanly. Bench on x86 without F16C before
  recommending it, because f16 may be software-emulated there.
- **AsyncContext:** add `fromAsyncContext() ?? createStorage()` to `hook-scope.ts`. It casts `globalThis` to a local
  structural type, so it passes `deno check` without `any` (TS has no lib type yet). It is dead code on every current
  target, so land it only with a stub-backed test (a `createHookScope(backend)` factory). The browser-first hook-scope
  work (hook context argument) may make it optional.
- **Workers + SAB:**
  - Upstream: a SAB backing option or a `SharedPartitionedBuffer`. `PartitionedBuffer extends ArrayBuffer`, so it can't
    be a SAB today.
  - Miski exports a cloneable column manifest: component, field, type, byteOffset and length.
  - Optional `reads`/`writes` per system. `order.ts` emits Kahn levels instead of a flat order, and undeclared systems
    act as barriers.
  - Worker writes bypass changed tracking, so mark changes in bulk at the join.
  - It needs `crossOriginIsolated` and a `runAsync` path.

  The cheapest first step is just the manifest, so users can run their own kernels.
- **`getOrInsert`, base64/hex:** gated on the Node floor (26 and 25), and even then low value.

## Remaining verification

- Safari support for `await using` / `DisposableStack`, and the `postTask` support versions.
- `Float16Array` performance on x86 without F16C. The Node 24.0 and Bun 1.3 floors come from BCD only.
- `scheduler.yield()` allocation cost inside real Chrome. The adapter prototype was measured on Deno with a
  `setTimeout` fallback.
- The workers/SAB crossover inside Chrome with `Atomics.waitAsync`.
