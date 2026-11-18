# Modern JS / web platform features for Miski

Research report, no source changes. Written 2026-11 against branch `1.0.0-alpha` (`deno.json` 1.0.0-beta.2; README
targets Deno ^2.9.7, Node ^24, Bun ^1.3; `lib: ["esnext","dom"]`, `erasableSyntaxOnly: true`).

Sources: GoogleChrome/modern-web-guidance-src (`guides/js/js/guide.md`, `guides/performance/{schedule-tasks-by-priority,
break-up-long-tasks}`, `features/*`), TC39 proposal tracker, MDN/Chrome Status from memory. **Version numbers below
come from memory, not live lookups; confirm on chromestatus.com / `deno eval` before adopting anything.** Items I am
unsure about are marked `(verify)`.

What the guidance repo covers that is relevant: `structuredClone`, copying array methods, `Object/Map.groupBy`,
`Promise.withResolvers`, `AbortSignal.timeout/any`, binary text encoding (base64/hex), `scheduler.postTask` /
`scheduler.yield`, Temporal, workers/Wasm. It says nothing about `using`, `Float16Array`, resizable buffers, iterator
helpers or `AsyncContext`; those come from TC39/Chrome status.

Key constraint: Miski's hot paths are zero-allocation and GC-budgeted (`deno task bench:gc`). Anything that allocates
per call (iterator helpers, `using` on a fresh object, `structuredClone`) is out of the hot path by definition, and any
change to column storage ripples through `@phughesmcr/partitionedbuffer`, which Miski does not own in this repo.

## Ranked table

| # | Feature | Where in Miski | Benefit | Cost / risk | Support | Recommendation |
|---|---|---|---|---|---|---|
| 1 | `Symbol.asyncDispose` on `World` | `world.ts:550` `destroy()` | Ergonomics: `await using world = ...` guarantees teardown in tests/examples | One method alias; no behaviour change; TS >= 5.2 | Chrome 134, Deno 2.x, Node 24, Bun (verify) | **Adopt now** |
| 2 | `Error.isError` | `command-buffer.ts:687` (`instanceof Error`) | Correct across realms (workers, iframes, vm); also catches DOMException-like errors | Trivial; needs `typeof Error.isError` guard or lib typing | Chrome 134, Deno >= 2.2, Node 24 | **Adopt now** |
| 3 | `Promise.withResolvers` (finish) | `world.ts:352-354` hand-rolled `new Promise` + stored resolver; `world.ts:118` already uses it | Consistency, 3 fewer lines | Executor-throw semantics unchanged here (resolver only) | Chrome 119 | **Adopt now** |
| 4 | `Promise.try` | `system-manager.ts:134` (`Promise.resolve(initResult)` after manual `try`), other hook wrappers | Removes sync-throw/async-reject split in hook runners | Hooks are called synchronously on purpose (`runInHookScope`); only use where result is already thenable-checked | Chrome 128, Deno 2.x | Later (low value) |
| 5 | `using` for checkpoints/rollback points | `checkpoint.ts` (`captureCheckpoint`, `world.ts:663`), `rollback.ts` | Scoped capture/discard; guarantees buffers released on throw | Public API addition on returned objects; must not allocate on hot path; checkpoints are pooled so dispose = return to pool | Chrome 134 | Later (design first) |
| 6 | `using` for CommandBuffer / borrowed lists | `command-buffer.ts`, `query-pool.ts`, `archetype.ts:350` | Nothing to dispose: borrowed views are not owned | Forcing `Symbol.dispose` onto reusable views adds a call per query | - | No |
| 7 | Iterator helpers | `query-iterators.ts:87`, `relation-list.ts:107`, `entity.ts:182,224` | `.map/.filter/.take` for cold code (debug tools, tests, editor) | Each helper allocates an iterator wrapper; breaks GC budget on hot paths; reusable iterators (`ReusableEntityIterator`) already beat them | Chrome 122, Deno, Node 22 | No for core; allow in docs/examples |
| 8 | `Float16Array` columns | `component.ts:21-30` (`SUPPORTED_COLUMN_CONSTRUCTORS` rejects it explicitly) | Half memory for normalized values (colors, UVs, health fractions); `Math.f16round`, `DataView.getFloat16` | Needs partitionedbuffer + `TypedArrayConstructor` typing support; ~3 decimal digits, easy to misuse; saves/field-codec/layout need a new type tag | Chrome 135, Deno (V8 >= 13.5), Node 24, Bun (verify); TS lib `esnext.float16` (TS 5.9+) | Later (after partitionedbuffer) |
| 9 | Resizable `ArrayBuffer` / growable `SAB` | `utils.ts:70` `growTypedArray`; `relation-store.ts:201-208`; `archetype.ts:171-182`; `relation-list.ts:50` | Grow without copy/re-point; length-tracking views | Capacity is a fixed world param already, so only pools grow; length-tracking views have slower element access in V8 (verify with bench); borrowed views stay valid only if tracking, changing the "re-read after growth" contract | Chrome 111, Deno, Node 20+ | Later (prototype + bench) |
| 10 | `ArrayBuffer.prototype.transfer` | `growTypedArray` (grow = alloc + copy today); worker handoff | Possible realloc without copy, and detaches old buffer (kills stale borrowed views loudly); zero-copy to workers | Detaching changes semantics for anything still holding the old view; gain only at growth events | Chrome 114, Deno, Node 21+ | Later (pair with #9) |
| 11 | `Uint8Array` `toBase64` / `toHex` / `fromBase64` | `format.ts:262` `hashHex`, `schema.ts:296` fnv hex; save-to-string transport (JSON view in `document.ts:403`) | Native, no `btoa`/loop; a `worldSaveToBase64()` helper for localStorage/URL transport | `document.ts` currently has no binary-to-string step, so benefit is only for new helpers; Deno/Node support lags Chrome (verify); needs fallback | Chrome 140, Safari 18.2, Node 25 (verify), Deno (verify) | Later; feature-detect with fallback |
| 12 | `Map.prototype.getOrInsert[Computed]` / WeakMap | `ecs-world.ts:195,292`, `prefab.ts:203`, relation/query registries using `get`/`has`+`set` | Removes double lookups and `??=` boilerplate | Stage 3 (upsert); shipped in Chrome ~145, Deno/Node later (verify); needs fallback or lib types | Chrome 145 (verify) | Later; no benefit measurable on cold paths |
| 13 | `AsyncContext` | `hook-scope.ts` (uses `process.getBuiltinModule("node:async_hooks").AsyncLocalStorage`; browsers fall back to teardown signal) | Would give browsers the same deterministic self-wait detection as Deno/Node | TC39 stage 2, V8 behind a flag, **not shipped in Chrome** (verify). Do not depend on it | not shipped | Later: add as a feature-detected second backend behind the existing `AsyncLocalStorageLike` shape |
| 14 | `scheduler.postTask` / `scheduler.yield` | `schedule.ts` (frame/systems runner) | Opt-in "yield between systems" mode so long frames do not block input; priority-aware background systems | Core is synchronous by design; async variant changes determinism and rollback assumptions; belongs in an adapter, not core | Chrome 94 / `yield` 129; Deno/Node absent (needs guard) | Later, as optional adapter |
| 15 | Workers + `SharedArrayBuffer` systems | Column storage (partitionedbuffer), `Schedule` | The SoA layout is the natural fit for parallel systems | Needs cross-origin isolation (COOP/COEP), `Atomics` sync, a data-race model; huge scope; commands/relations/archetype moves are single-threaded | Chrome (isolated pages) | Later (research spike); no for 1.0 |
| 16 | `structuredClone` | `prefab.ts`, field `object` encode/decode cells, checkpoint object columns | Clone object-field values (Map/Set/typed arrays/cycles) | Allocates, throws on functions, drops prototypes; Miski already has canonical encode/decode hooks (`canonicalize.ts`) | Everywhere | No (leave to user hooks) |
| 17 | `Atomics.pause` | none | Only for worker spin-waits | No workers today | Chrome 133 | No (revisit with #15) |
| 18 | `Math.sumPrecise` | none | No float summation in core | - | Chrome 140ish (verify) | No |
| 19 | `RegExp.escape` | none (no regexes built from user input) | - | - | Chrome 136 | No |
| 20 | Records/tuples | - | - | Withdrawn; successor ("Composites") early stage | none | No |
| 21 | Decorators | - | - | Stage 3, not natively shipped; not erasable TS, conflicts with `erasableSyntaxOnly` | none | No |
| 22 | Import attributes | - | Nothing to import as JSON | - | Chrome 123 | No |
| 23 | Web Locks / OffscreenCanvas | - | Out of scope for an ECS core | - | Chrome | No |

## Adopt now, ordered by value per effort

1. **`Error.isError` in the command buffer** (minutes, tiny risk).
2. **Finish `Promise.withResolvers` in `World` constructor** (minutes, zero risk).
3. **`World[Symbol.asyncDispose]`** (small, additive, high ergonomic return in tests and examples).

None of these touches a hot path, so the GC budgets are unaffected. Everything else is "later": the two with real
upside (`Float16Array`, resizable buffers) both hinge on `@phughesmcr/partitionedbuffer`, so the first action is an
upstream issue/PR there, plus a bench of length-tracking view access.

### 1. `Error.isError` (`command-buffer.ts:687`)

```ts
// before
if (!(error instanceof Error) || record >= this.#recordCount) return;
// after
if (!Error.isError(error) || record >= this.#recordCount) return;
```

Cross-realm safe (errors thrown from worker-originated or iframe callbacks fail `instanceof`). TS: needs `lib` with
`Error.isError` (TS 5.9+ `esnext.error`); if the pinned Deno's TS lacks it, declare a one-line ambient type. Add a
`typeof Error.isError === "function"` fallback only if Node/Bun floors lack it (Node 24 and Bun 1.3 have V8/JSC support;
verify Bun).

### 2. `Promise.withResolvers` in the `World` constructor (`world.ts:352-354`)

```ts
// before
this.#initPromise = new Promise((resolve) => { this.#initResolver = resolve; });
// after
const init = Promise.withResolvers<WorldInitResult>(); // match the existing resolver's type
this.#initPromise = init.promise;
this.#initResolver = init.resolve;
```

Identical behaviour, same style as `#teardownStarted` at `world.ts:118`, matches the guidance guide's DO.

### 3. `Symbol.asyncDispose` on `World` (`world.ts:550`)

```ts
async destroy(): Promise<void> { /* unchanged */ }
async [Symbol.asyncDispose](): Promise<void> { await this.destroy(); }
```

```ts
await using world = new World(spec);
// ... run frames; destroy() runs on scope exit, even on throw
```

Requirements: TS 5.2+ (already satisfied by `lib: esnext`), `Symbol.asyncDispose` exists in Chrome 134+, Deno, Node 24,
Bun (verify). **`destroy()` is not idempotent**: it throws when the state is `uninitialized` or `destroyed`
(`world.ts:551-553`) and when already destroying. So the dispose method must skip those states
(`if (state is initialized or error) await this.destroy()`), otherwise `await using` after an explicit `destroy()`, or
on a world that never initialized, throws from the disposer. Add a CHANGELOG line and tests for disposal on throw and
after explicit destroy. Optionally the same for `Schedule` if it owns resources (not examined).

## Notes on specific "no" and "later" calls

- **AsyncContext** is the right long-term replacement for `AsyncLocalStorage` in `hook-scope.ts` because it is standard
  and works in browsers, but it has not shipped in Chrome, so replacing ALS now would regress Deno/Node/Bun. The module
  already isolates the storage behind `AsyncLocalStorageLike`; the future change is a second `createStorage()` branch
  using `new AsyncContext.Variable()`, preferred when present. Re-check chromestatus before each release.
- **Float16Array**: `component.ts:21` documents it is rejected because the public `TypedArrayConstructor` type lacks
  it. That is a partitionedbuffer typing gap, not a platform gap. Saves would need a new field-type tag (the layout
  code in `serialization/layout.ts` hashes layouts, so adding a type is a format version event).
- **Resizable buffers**: the "re-read columns after the pool grows" contract (`world-relation-api.ts:34`) exists
  because growth swaps arrays. Length-tracking views would remove the contract, but V8 optimizes fixed-length views
  better, which is Miski's whole premise. Only worth it if a bench shows no regression.
- **Iterator helpers**: acceptable for tooling on top of Miski (docs/examples); do not use in `src/` iterators. Miski's
  own `[Symbol.iterator]` returns reusable iterator objects to avoid allocation; helpers would defeat that.
- **scheduler.yield / postTask** from the guidance repo suit apps *using* Miski (yield between `world.update` calls or
  between phases), not the core. A docs recipe is cheaper than an API.
- **Base64/hex**: `hashHex` and `fnv1a64` use `toString(16)` on numbers/BigInt, which `Uint8Array.toHex` does not
  replace (they hash to numbers, not bytes). Value is limited to new save-transport helpers.

## Verification still needed

Checked on the pinned Deno 2.9.8 (CI runtime), with this command:

```bash
deno eval 'console.log(typeof Error.isError, typeof Float16Array, typeof Uint8Array.prototype.toBase64, typeof Map.prototype.getOrInsert, typeof Promise.try, typeof Symbol.asyncDispose, typeof AsyncContext)'
```

Result: `Error.isError`, `Float16Array`, `Uint8Array.prototype.toBase64`, `Map.prototype.getOrInsert` and `Promise.try`
are all functions; `Symbol.asyncDispose` is a symbol; `AsyncContext` is `undefined`. So Deno CI supports every runtime
feature in the table except `AsyncContext`. Chrome and Node/Bun versions are still from memory. TS typing (the `lib`
entries for `Error.isError`, `Float16Array`, `getOrInsert`) was not checked; run `deno check` on a scratch file first.
