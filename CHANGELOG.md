# Changelog

## Unreleased

- Fix: `ComponentInstance.set()` and `setAt()` no longer move the shared
  `instance.proxy` cursor. Before, `inst.set(b, "x", 9)` left a proxy that a
  system had pointed at `a` reading and writing `b`. Single-field writes now go
  through per-column writers that the proxy setters share, so validation,
  encoding, change marking and revision bumps are unchanged. `set` checks
  ownership once instead of twice.
- **Breaking:** component and relation schemas no longer accept
  PartitionedBuffer's `[Ctor, initial]` column tuple. It was never fully
  supported: the initial value was dropped and storage started at 0, and
  `compileComponentSchema` already rejected it. `new Component`, `new Relation`,
  `compileComponentSchema` and `componentSchemaHash` now throw a `SpecError`
  naming the column (not the generic `TypeError`). Declare the bare
  typed-array constructor instead.
- **Breaking (types):** `ComponentFieldSpec` is now `TypedArrayConstructor |
  FieldDescriptor`, `SchemaPropertyArray` drops its tuple branch, and
  `DataRelationSpec` and `createEcsWorld` relation-option schemas are
  `Record<string, TypedArrayConstructor>`. A
  schema annotated with PartitionedBuffer's `Schema<T>` (whose properties allow
  tuples) no longer type-checks as a component schema; use `FieldSchema<T>` or
  `defineComponentSchema`.
- **Breaking (types):** `StorageProxySpec` no longer has `markChanged`; the
  `StorageProxy` constructor now takes a required `writers` map (from the
  internal column writers) instead of `coercionScratch`, `sideFields` and
  `componentName`; and `ComponentInstanceSpec` gains required `writers` and
  `capacity`. These only matter if you construct `StorageProxy` or
  `ComponentInstance` yourself.
- Add `WorldRollbackScope`: a rollback point for `using` blocks. Leaving the
  block without `commit()` restores the world, so a throw can't leave the
  world's one rollback scope open (which blocked every later capture and world
  load). It also has `restore()` and `isOpen`. On a world that is no longer
  initialized, disposal just drops the point.
- `World` implements `Symbol.asyncDispose`: `await using world = new World(spec)`
  destroys it when the scope exits, even on a throw. A never-initialized or
  already destroyed world is left alone; overlapping disposals share one
  teardown, and a failed teardown can be retried.
- Command-buffer flush errors are annotated with the failing command for any
  real `Error`, including ones from another realm (`Error.isError`).
- README: a recipe for yielding to the browser between `Schedule.run()` calls.
- Support `Float16Array` component columns (requires
  `@phughesmcr/partitionedbuffer` ^0.5.0, now the minimum). Schemas hash it as
  `f16`; hashes of existing schemas are unchanged. World saves use the new field
  type code 12 (`"f16"`), so saves without f16 columns are byte-identical and
  older versions reject f16 saves as an unknown field type.
- `World.destroy()` is idempotent: on a destroyed world it now resolves without
  doing anything instead of throwing. A call while teardown is still running
  still rejects ("World is being destroyed").
- Add non-numeric component fields with `field.bool()`, `field.enum([...])`,
  `field.entity()`, `field.string()` and `field.object<T>({ create?, clone? })`.
  Bool, enum and entity fields use typed columns in the world buffer (`0 / 1`,
  the label index, and the packed handle with `-1` for none). String and object
  fields use capacity-length JS arrays indexed by slot. All of them appear in
  `storage.partitions`. Guarded writes check value types; entity fields reject
  handles that are not live; guarded reads decode values, and an entity field
  reads `null` once its target is destroyed. New owners start at `false`, the
  first label, `null`, `""`, or `create()`. Removing a component releases its
  string and object values. Rollback and checkpoints copy object references,
  or call `clone` when it is given.
  Object fields also accept `encode` / `decode` hooks (a JSON-safe
  `string | number | null` form) for saving worlds; neither is hashed.
- Export `cloneFieldValue` (copies a value the way rollback and checkpoints
  do) and `isFieldDescriptor`.
- `Component.schema` now returns the declared schema, including field
  descriptors. `Component.isTag` is `false` for components with only string or
  object fields. Numeric schema hashes are unchanged.
- `ComponentCheckpoint` payloads and `ComponentData` / `ComponentValue` for
  field columns are no longer numbers. `ComponentInstance.get` / `getAt` keep a
  `string`-key overload typed `number`, so cast results from untyped instances.
  `instance.storage.get` / `set` are now typed per column (`StorageCell`), and
  `StorageProxySpec<T>` requires `T extends SchemaOrNull`.
- Add prefabs: immutable entity templates defined with `new Prefab({ name, extends?, components })`.
  `extends` flattens a parent prefab at definition time, and child fields override the parent's field by
  field. Prefabs live outside every world, so they use no entity slot and never appear in queries. Create
  instances with `world.entities.instantiate` / `instantiateOrThrow`, or all-or-nothing in bulk with
  `instantiateMany` / `instantiateManyOrThrow`, which return a borrowed list. Override tuples merge per field
  over the defaults and may add components. An instance is indistinguishable from `createWith` with the
  equivalent bundle, and steady-state instantiation allocates nothing. `EcsWorld` gains `prefab`,
  `instantiate` and `instantiateMany` for named specs.
- World saves record `field.*` hash tags (`bool`, `entity`, `enum:[...]`) as field types, so the layout check
  catches kind changes and reordered enum labels.
- World saves support `field.string()` and `field.object()` fields. Strings are written as UTF-8 (an offset table
  plus a heap), and `saveWorldInto` stays allocation-free for them; a string with a lone surrogate throws
  `WorldSaveError`. Object fields are saved through their `encode` / `decode` hooks, which are never called with
  `null`; a component whose object field has no hooks throws `WorldSaveError` naming the field. Loads run every
  `decode` before changing the world, so a throwing hook leaves it untouched. The JSON view holds strings as
  strings and object cells as `WorldSaveObjectValue` (`{ number: "NaN" }` and so on for numbers JSON cannot hold).
  `WorldSaveComponentDocument.values` is now typed `WorldSaveFieldValues`.
- World saves support relations. A RELATIONS section holds each relation's row pool, sources and pairs in store order,
  target lists, changed sources and live pair data, so a loaded world returns the same `getTargets`, `getSources` and
  `traverse` order and hands out the same rows. The layout records `exclusive`, `acyclic`, `onDeleteTarget` and pair
  fields (`WorldSaveLayout` components gain an optional `relation`), and every load checks pairs, rows, target lists
  and acyclic chains before changing the world. The JSON view gains `relations`, keyed by relation name and present
  only when the layout has relations (`WorldSaveRelationDocument`, `WorldSaveRelationPair`). Saves of worlds without
  relations are unchanged, and `saveWorldInto` stays allocation-free with relations.
- Command buffers carry `field.*` values through their side column. A queued entity-ref value whose target died
  before the flush is written as `null` instead of failing the command; direct guarded writes still reject dead
  handles.
- Prefabs reject relations, in definitions and in instantiate overrides (a pair needs a target in a specific
  world); attach pairs with `world.relations` after instantiating. Relation pair data stays numeric: `field.*`
  descriptors in a relation schema throw `SpecError`.
- Prefabs support `field.*` columns. Defaults are logical values (`Prefab.get` returns booleans, enum labels and
  strings). Entity-ref defaults must be `null`; pass targets as instantiate overrides. An object field with no prefab
  value calls `create()` for each instance; a given object value is cloned per instance and needs the field's `clone`
  hook, or the prefab is rejected at definition. Null and primitive object-field values are stored as is.
- Post-merge review fixes:
  - Command buffers reject relation components when queuing, as the direct calls do, instead of at flush.
  - Relation pair data treats `undefined` values as absent.
  - Applying a checkpoint whose relation pairs are unchanged keeps each target's source order and marks nothing
    changed.
  - World loads reject bool, enum and entity cells outside their field type, and next generations that would
    reissue a live handle once masked.
  - Nested `instantiateMany` calls each keep their own borrowed list.
  - A throwing `create()` / `clone()` hook, or a rejected `CommandBuffer` command, no longer keeps already-staged
    string and object values alive.
- Add entity relations and hierarchies. A `Relation` registers in
  `WorldSpec.components` like a component. Its presence is a tag, so queries
  match any target without archetype fragmentation, and pairs live in a side
  index reached through the new `world.relations` API: `add`, `remove`,
  `removeAll`, `has`, `getTarget`, `getTargets`, `getSources`,
  `getAllTargets`, `queryList`, `getData`, `readDataInto`, `setData`,
  `getChanged`, `traverse` and `getInstance`. Relations may be exclusive
  (`exclusive`) and cycle-free (`acyclic`), carry typed per-pair data, and
  destroy their sources when a target is destroyed
  (`onDeleteTarget: "cascade"`); by default only the pairs are removed.
  Rollback and component checkpoints restore pairs, order and data exactly.
  `createEcsWorld` accepts `relations`. The generic component add and remove
  APIs throw a `TypeError` for relation tags. `WorldContext` gains
  `relations`.
- Add `Schedule`, a system scheduler. Systems run in user-defined phases, in
  insertion order adjusted by `before` / `after` constraints (deterministic;
  cycles throw `SpecError` naming the path). Contiguous fixed phases run once
  per fixed step from an accumulator (`fixedStep`, `maxFixedSteps`, `alpha`).
  Systems get one reused `ScheduleContext` and must declare `argCount` 1 or 0.
  `runIf` and `setEnabled` skip systems. `run(dt)` refreshes the world once at
  the end, like `world.frame`, and is allocation-free in steady state.
  `getClock()` / `setClock()` save and restore its clock as plain data
  alongside a world save or rollback point (between runs only).
- Add `CommandBuffer` for deferred `spawn` (with a bundle, returning a
  `PendingEntity`), `destroy`, `add`, `set` and `remove`. Queuing validates
  and copies data; `flush()` applies commands in order like the direct calls
  and skips commands for inactive entities. A failing command does not stop
  the flush: the rest still apply and the first error is rethrown. Non-numeric
  schema fields are queued by reference and validated at flush. A `Schedule`
  flushes its buffer at the end of each phase.
- Add whole-world saves. `saveWorld` / `saveWorldInto` (no allocation with a
  reused buffer) write entity handles and generations, allocator state,
  component ownership, values and changed lists, archetype registry order and
  the open transition window. `loadWorld` replaces an initialized world's state
  with a save so that it behaves exactly like the saved world, including future
  entity handles and every iteration order. Loads validate the whole save
  first and throw the new `WorldSaveError` without changing the world. A save
  loads only into a world with the same layout; `loadWorld`'s `migrate` option
  converts a save written with a different layout. Also add
  `measureWorldSave`, `readWorldSaveHeader`, `describeWorldSaveLayout` and a
  lossless JSON view (`worldSaveToJSON` / `worldSaveFromJSON`).
- Reuse entity slots next-fit instead of last-freed-first. A destroyed entity's
  slot is reissued only after the allocator has swept past every other free
  slot, so a held stale handle no longer comes back to life after 32,768
  create-then-destroy cycles. A handle can now repeat only after about
  32,768 x (free slots) creations, or 32,768 when a single slot is free. Code
  that expected `create()` to return the most recently freed slot must not
  rely on slot order.
- Drop the `@phughesmcr/bitpool` dependency; entity occupancy now lives in a
  small internal allocator over `@phughesmcr/booleanarray`.
- Detect lifecycle calls from system hooks the same way in every runtime,
  replacing the `AsyncLocalStorage` path that only Deno, Node and Bun had.
  `init` and `destroy` hooks now receive a second argument, a
  `SystemHookContext` with `onReady()`, `destroyWorld()`,
  `destroySystem(system)` and `pending`. While the hook is pending these
  reject with `WorldStateError` instead of waiting on the hook itself, even
  after an `await`; once it settles they act like the world calls. Calling
  `world.onReady()`, `world.destroy()` or `world.systems.destroy()` directly
  is only rejected in the synchronous part of a hook. After an `await` the
  world cannot tell the hook is calling: on Deno, Node and Bun these calls no
  longer reject. A waiting `world.onReady()` is still released by teardown,
  but a hook that waits on its own system's destruction (directly or through
  a cycle) never settles. Use the hook context after an `await`. The first
  argument is still the world itself. Exports `SystemHook` and
  `SystemHookContext`.

## 1.0.0-beta.2 — 2026-11-18

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
  the call to come from the hook: see the hook context entry under Unreleased.
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
  `world.destroy()`: they throw `WorldStateError` when the call is known to
  come from the hook (see the hook context entry under Unreleased). Do not
  await either from a hook.
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
