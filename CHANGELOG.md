# Changelog

## Unreleased

- Add `SystemSpec.argCount` (0 to 4). A system created with it forwards exactly
  that many arguments to its callback without allocating per call; missing
  arguments arrive as `undefined` and extras are dropped. Systems without it
  forward arguments exactly as before.
- Capture rollback state from owned rows only. Rollback no longer captures or
  reverts raw storage writes to slots that do not own the component; reads
  through ownership-checked APIs are unaffected.
- Entries in a `BorrowedEntityList`'s `slots` / `entities` past `count` may now
  hold stale values. They were already documented as invalid; read only the
  first `count` entries.
- Make rollback restore observationally neutral. After
  `restoreWorldRollbackPoint`, entity allocation order, `queryList` and
  `getOwners` iteration order, and entered / exited match a world that never
  speculated. Archetypes first registered during the speculative scope are
  dropped on restore.
- Report `queryEntered` / `queryExited` in first-touch order within the
  refresh window instead of archetype order. Code that depended on the old
  ordering should sort explicitly.
- Size archetype entity lists by population instead of world capacity. Many
  archetypes in a large world no longer cost about 1 MB each.
- Capture and restore rollback state with typed-array copies. At capacity
  65536, capture plus commit drops from about 15 ms to under 1 ms.
- Throw `TypeError` from `getActive` / `getActiveSnapshot` for non-integer
  bounds (including `NaN`) instead of a storage-layer error.
- Let `Query.compose` merge an `include` entry with an `all` or `any`
  entry for the same component under the same key; the `include` entry is
  dropped. The same component under different keys still throws `SpecError`.
- Mark data components changed when attached without a payload, matching the
  explicit-payload path (single, batch, bundle, and `createWith`).
- Keep an in-progress `getOwners` iteration intact across
  `applyCheckpoint`.
- Remove every staged component when a bundle spawn fails partway, so no
  ownership or sparse row outlives the rolled-back entity.
- Reject, rather than deadlock, a system hook that destroys a system whose
  destruction waits on that hook (including its own system). It rejects with
  `WorldStateError`; non-cyclic destroys from hooks still work. Detection needs
  `AsyncLocalStorage` (Deno, Node, Bun); in browsers, do not await a destroy that
  waits on the calling hook.
- Make `world.systems.destroy` always return a promise. World-state failures
  now reject instead of throwing synchronously.
- Allow systems whose query has only `none` terms. The callback receives an
  empty components record and the matching entities.

## 1.0.0-beta.1 — 2026-10-05

Beta hardens the existing ECS surface. It introduces no new ECS features.

- Reject schema fields named `entity` or `slot`, which collide with proxy
  cursors. Rename those fields before upgrading.
- Initialize capped and dense data components with the same zero defaults,
  including attachment without a payload. Checkpoints now round-trip those
  capped defaults.
- Preflight spawn payloads and component caps before allocating an entity.
  Validation failures no longer publish phantom exit events, change revisions,
  or consume handle generations.
- Use `SlotIndex` bounds for `getActive` and `getActiveSnapshot`: inclusive
  start, exclusive end. Replace packed bounds with `entityIndex(handle)`;
  use `asSlotIndex(world.entities.capacity)` for the exclusive capacity bound.
- Require system readiness before invocation. Await `init()` or `onReady()`;
  `onReady()` includes pending late system initialization. Hooks retain entity
  mutation access, so `state === "initialized"` alone does not mean ready.
- Close registration and callbacks during world teardown. `destroy()` called
  during an in-flight `init()` waits for it, then tears down. Run all destroy
  hooks even if one fails. Concurrent world teardown rejects; concurrent
  individual system destruction runs its hook once. Destroy-hook failures leave
  the world in `error`.
- Make `world.destroy()` work from `error`: after a failed `init()` the failed
  system is unregistered, and teardown runs destroy hooks only for systems whose
  init completed. The world ends `destroyed` if all succeed, otherwise stays
  `error`. `systems.destroy(sys)` waits for that system's pending init and skips
  the destroy hook if init never ran; destroying a system while its late init
  is pending discards it, so a later init failure does not poison the world.
- Reject, rather than deadlock, lifecycle hooks that await `world.onReady()` or
  `world.destroy()`: they throw `WorldStateError`. Deterministic where
  `AsyncLocalStorage` exists (Deno, Node, Bun); in browsers, waiting `onReady()`
  calls reject once teardown starts. Do not await either from a hook.
- Attach `cause` to `WorldStateError` and other `MiskiError` subclasses. After
  a late init failure, `onReady()` and assert errors expose the root cause via
  `error.cause`, and `init()` rejects with the root cause when an init hook
  registers a failing system.
- Rethrow the `frame()` callback's own error instead of a generic "World has
  encountered an error".
- Make `queryEntered` / `queryExited` window-relative: entered means a member
  now but not at window start; exited means a member at window start but not
  now. Moving between archetypes that both match, remove-then-re-add within one
  window, and spawn-then-destroy within one refresh window report neither.
- Make bundle spawn (`createWith`, `createWithOrThrow`, `EcsWorld.spawn`)
  atomic; it no longer reports a false exit from the root archetype.
  `createWith` / `createWithOrThrow` validate the payload before checking
  capacity, so invalid bundles throw (`createWith(42)` throws `TypeError`) even
  on a full world. `EcsWorld.spawn` treats `undefined` tag values as absent.
- Throw `SpecError` from `Query.compose` when more than one input has a
  non-empty `any` group. It previously merged them into one OR, which was too
  permissive; fold the groups into a single `any` before composing.
- Update query membership incrementally after archetype moves, a large speedup
  with many archetypes and queries.
- Fix capped components: stray raw, proxy or `setAt` writes to non-owner slots
  no longer consume the cap or half-commit a later add (such data is discarded
  when the row is needed), and `getChanged` yields only owners.
- Always mark a component changed when it is added with a payload to a new
  owner, in dense and capped storage. Dense storage previously skipped the mark
  when values equalled zero or stale data.
- Clamp `maxEntities` above world capacity for storage sizing, avoiding huge
  allocations and `RangeError`. Fractional or `NaN` `maxEntities` or capacity
  throw the documented `TypeError`.
- Limit column types to `Int8Array`, `Uint8Array`, `Uint8ClampedArray`,
  `Int16Array`, `Uint16Array`, `Int32Array`, `Uint32Array`, `Float32Array` and
  `Float64Array`. `BigInt64Array`, `BigUint64Array` and `Float16Array` are now
  rejected at `Component` construction; `Float16Array` previously worked via
  `new Component`, so store such fields as `Float32Array`.
  `compileComponentSchema` accepts `Uint8ClampedArray`; existing schema hashes
  are unchanged.
- Align CI and release instructions with `master`, validate the alpha branch
  on push, and pin the Deno release toolchain to 2.9.7.
- Replace the unresolved Bun source-build task with Deno's standalone ESM
  browser bundle. Add clean package installation, consumer types, and real
  Chromium smoke checks before publishing.
- Split the publish workflow into an unprivileged verification job and a
  minimal OIDC publish job; require the tag to match `deno.json`, and require
  stable releases to be reachable from `master` (pre-releases may be tagged on
  any branch). Pin third-party actions to commit SHAs where resolvable and add
  job and subprocess timeouts.
- Type-check the `mod.ts` JSDoc examples (`deno task check:docs`) and keep the
  README install snippets in step with the package version.

Borrowed query/owner/change views remain valid only until mutation or refresh;
copy them with the snapshot helpers for retained use. `frame` callbacks are
synchronous: consume transition and changed windows before they return.
Checkpoints remain reusable and bound to one world. Rollback captures ECS
entity/component/transition state, permits one active scope, and consumes a
point on commit or restore; it does not undo system hooks or external effects.

## 1.0.0-alpha.3 — 2026-07-02

- Add atomic component bundles: `addBundle` on entities, plus `createWith` and
  `createWithOrThrow` to spawn an entity with its components in one archetype
  move.
- Add `readEntityDataInto` for zero-allocation reads into a reused object and
  `ComponentInstance.has` / `markChanged` ownership-guarded helpers.
- Accept `TValue` / `TStorage` generics on components so public writes can be
  narrower than the typed-array storage schema.
- Extend `Query` with non-filtering `include` components that systems can read
  without affecting membership.
- Expand the benchmark and GC-allocation suites and refresh the README
  performance figures.

## 1.0.0-alpha.2 — 2026-07-02

- Add `CapacityError` and `createOrThrow` for callers that prefer an exception
  to an `undefined` result when the world is full.
- Add `readEntityData`, a non-throwing read that returns `undefined` for
  inactive entities, non-owners, and tag components.
- Make `addToEntity` an upsert: ownership is unchanged and provided fields
  merge into the existing data.
- Make borrowed entity lists directly iterable.
- Export the `ComponentPartitions`, `SchemaValues`, `TypedArray` and
  `TypedArrayConstructor` types and tighten component partition and query
  constructor typing.

## 1.0.0-alpha.1 — 2026-06-20

First 1.0 pre-release. Rewrites the library around typed-array SoA storage and
dense, zero-allocation query iteration.

- Replace `defineSystem` with `new System` and `new Query`; type system and
  component definitions with keyed queries.
- Rework `World` lifecycle management (`init`, `refresh`, `destroy`) and
  system registration.
- Add dense `queryList` hot paths, batch archetype transitions, and query
  membership management; use typed `EntityArray` storage for entity handles.
- Improve error handling for component and entity management and export
  `NoComponentsFoundError`.
- Enforce a minimum world capacity of 8.
- Add the visual browser demo and benchmark suites, shared test fixtures, and
  CI validation.
