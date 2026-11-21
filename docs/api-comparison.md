# Miski's public API compared with other ECS libraries, and a proposed 1.0 surface

Written 2026-11-20 against `1.0.0-alpha` at `be0dee2` (`1.0.0-beta.3`). `mod.ts` exports 173 symbols:
11 classes, 20 functions, 12 interfaces, 115 type aliases, 12 variables and 3 class/interface or
interface/variable pairs.

## Summary

- **Most of the beta.3 review backlog has landed.** A1, A5, A6, A7 and A9 are done. Most of A2, A3, A4, A8, A10 and A11
  is done. What remains is small (see [Backlog](#backlog-a1a11-from-the-beta3-review)).
- **Miski's shape matches the reference designs on the parts that are hard to change later.** It has generational
  packed handles, SoA typed-array storage with a raw hot path, `all` / `any` / `none` queries, relations with
  `exclusive`, `acyclic` and cascade-on-delete, a phased schedule with `before` / `after` / `runIf` and a fixed step, a
  command buffer flushed at phase ends, and prefabs.
- **Miski goes beyond the field in two areas:** saves with an explicit layout check and a `migrate` hook, and an
  error model with one base class.
- **The main mismatch was naming in `world.components`.** Every other library, and Miski's own `world.relations` and
  `ComponentInstance`, use short `add` / `remove` / `has` / `get` / `set` verbs. `world.components` used
  `addToEntity`, `removeFromEntity`, `entityHas`, `getEntityData` and `setEntityData`. This branch renames them (D1).
- **One real gap: change detection lives on the world, not on the query.** Every other library with change detection
  puts it on the query: Bevy `Added<T>` / `Changed<T>`, Koota `createAdded()` / `createChanged()`, Becsy `q.added` /
  `q.changed`, flecs `detect_changes()`. That can be added after 1.0 without breaking anything, so it does not block a
  freeze.
- **Changes on this branch** (the "clearly right" set; each is in the CHANGELOG under Unreleased):
  1. `world.components.getChanged` / `getOwners` and their `*Snapshot` forms throw `NotRegisteredError` for an
     unregistered component instead of returning `undefined`. This matches `getData`, `readDataInto` and
     every `world.relations` call. Their return types lose `| undefined`.
  2. `world.components.getInstances` leaves the public type. It was query-manager plumbing, and
     `getInstance` covers it.
  3. The save format's compatibility promise is written down: in this document, in the README and on
     `FORMAT_VERSION`.
- **Decisions:** D1–D12 are in [Decisions](#decisions-for-the-maintainer). The maintainer accepted every
  recommendation, and this branch implements them. Only D9 is open: the freeze waits on the entity-cap research,
  because lifting the 65,536 cap may change `Entity` packing and the save format.

## Sources and method

Each library was read from its current docs, and for bitECS and Koota from source as well, on 2026-11-20:

| Library | Version read | Depth |
| --- | --- | --- |
| bitECS | `master`, `package.json` 0.4.0 | README, `docs/API.md`, `docs/Serialization.md`, `src/core/index.ts`; error paths verified in `src/core/{Component,Entity,EntityIndex}.ts` |
| Koota | `main`, published `koota` 0.6.6 | README, `packages/core/src/index.ts`; error paths verified in `trait/trait.ts`, `entity/entity.ts`, `world/world.ts` |
| Becsy | docs site (`/guide`, `/architecture/*`, `/deploying`) | docs only; source not read |
| miniplex | root and `packages/core` READMEs | docs only |
| ECSY | README (archived 2025-04-13) | docs only, briefly |
| ape-ecs | `docs/*.md` | docs only, briefly |
| flecs | v4.2.0; `docs/*.md` (Quickstart, Queries, Systems, Relationships, ComponentTraits, PrefabsManual, ObserversManual, Manual, MigrationGuide, FAQ) | docs only |
| Bevy ECS | `bevy_ecs` 0.20.1 on docs.rs; `bevy_world_serialization` 0.20.1; 0.19→0.20 migration guide | docs only |

Pages were read through a summarising fetcher, so the signatures below are second-hand except for the bitECS and Koota
error rows, which were checked against source. Rows marked "not found" mean the pages read did not cover the topic. It
does not mean the library lacks the feature.

## Comparison by area

### 1. World and entity creation

| | API |
| --- | --- |
| **Miski** | `new World({ capacity, components })`, then `await world.init()`. `world.entities.create(bundle?)` returns `Entity \| undefined` and `createOrThrow(bundle?)` returns `Entity`. `destroy(e)`, `isActive(e)`, `isEmpty(e)`. Handle: 16-bit slot + 15-bit generation, cap 65,536 per world. `createEcsWorld({...})` is a typed named-map façade over `World`. |
| bitECS 0.4 | `createWorld()`, `addEntity(world)`, `removeEntity(world, eid)`, `entityExists`. A plain number id, versioned only if you opt in (`withVersioning`). No cap check: `addEntityId` never throws. Removing a dead entity is a silent no-op. |
| Koota 0.6 | `createWorld()`, `world.spawn(...traits)`, `entity.destroy()`, `world.has(entity)`. Packed 4 world bits, 8 generation bits and 20 id bits. No cap check. Destroying a dead entity throws. |
| Becsy | `await World.create({ defs, maxEntities })`. `world.createEntity(C, {...})`, `entity.delete()`, `entity.alive`. Fixed `maxEntities`; exceeding it throws. Handles are valid only during the current system unless `hold()` is called. |
| miniplex | `new World()`, `world.add(obj)`, `world.remove(obj)`. Entities are plain objects. |
| flecs | `world.entity()`, `e.destruct()`, `e.is_alive()`. 64-bit id: 32-bit index plus a version. |
| Bevy | `world.spawn(bundle)`, `despawn`. `world.entity(e)` panics on a missing entity; `get_entity(e)` returns a `Result`. Index + generation. `to_bits()` is documented as not a wire format. |

**Converge on:** packed index+generation handles with an explicit liveness check; creating with initial components in
one call (`spawn(bundle)`); one world object as the entry point.

**Recommendation: keep.** `create(bundle?)` / `createOrThrow` match `spawn(bundle)`. Miski's names are `create` /
`destroy` where Bevy and Koota use `spawn` / `despawn` or `spawn` / `destroy`, and Becsy, ECSY and ape-ecs use
`createEntity`. Both names are common, and `create` matches `World`'s own vocabulary, so a rename buys nothing. The
async `init()` is unusual (only Becsy's `World.create` is async). It exists for async system `init` hooks. Keep it, but
note it as the one step of setup most libraries don't need. `EcsWorld` duplicates entity creation under `spawn` /
`spawnOrThrow`: see D4.

### 2. Component definition and data access

| | API |
| --- | --- |
| **Miski** | `new Component({ name, schema?, maxOwners? })`, with the schema built from typed-array constructors plus `field.bool/enum/entity/string/object`. Three access tiers: (a) `instance.storage.partitions[key][slot]`; (b) `instance.proxy`, `instance.get/set(entity, key)`; (c) `world.components.getData` / `getDataOrThrow` / `readDataInto` / `setData`. Structural changes: `add`, `remove`, `has`, `addBundle`, `addMany`, `removeMany` (renamed on this branch, D1; were `getEntityData`, `addToEntity` and so on). |
| bitECS | Any object is a component (SoA `{x: Float32Array}` or AoS). `addComponent(world, eid, C \| set(C, data))`, `removeComponent`, `hasComponent`, `getComponent`, `setComponent`. Components register automatically on first add. Hot path: `Position.x[eid]`. |
| Koota | `trait({x: 0})` (SoA) or `trait(() => obj)` (AoS). `entity.add/remove/has/get/set`. `getStore(world, T)` returns raw columns. |
| Becsy | A class with `static schema = { x: Type.float32 }`. `entity.read(C)` / `entity.write(C)` return views; `add/remove/has`. Every access needs a declared entitlement. |
| flecs | `e.add<T>()`, `e.set<T>({...})`, `e.remove<T>()`, `e.get<T>()`, `e.try_get<T>()`, `e.get_mut<T>()`, `e.ensure<T>()`. Hooks: `on_add`, `on_set`, `on_remove`. |
| Bevy | `#[derive(Component)]`. `insert(bundle)`, `remove::<B>()`, `get::<T>() -> Option`, `get_mut`, `take`. `#[require(B)]` adds required components. |

**Converge on:** the five verbs `add` / `remove` / `has` / `get` / `set`. Every library uses them, with or without a
`Component` suffix (bitECS `addComponent`, miniplex `addComponent`). Reads return `T | undefined`. A raw store sits
next to the guarded API for hot loops.

**Recommendation:**

- Keep the three tiers. They match bitECS (raw arrays), Koota (`getStore` vs `entity.get`) and Becsy (`read` vs
  `write`).
- **Rename the `world.components` verbs (D1; done on this branch).** No surveyed library uses `addToEntity` / `entityHas` /
  `getEntityData`, and Miski's own `world.relations` (`add` / `remove` / `has` / `getData` / `setData` /
  `readDataInto`) and `ComponentInstance` (`has` / `get` / `set`) already use the short forms. The map:

  | Before | 1.0 |
  | --- | --- |
  | `addToEntity(C, e, data?)` | `add(C, e, data?)` |
  | `removeFromEntity(C, e)` | `remove(C, e)` |
  | `entityHas(C, e)` | `has(C, e)` |
  | `getEntityData` / `getEntityDataOrThrow` | `getData` / `getDataOrThrow` |
  | `setEntityData` | `setData` |
  | `readEntityDataInto` | `readDataInto` |
  | `addToEntities` / `removeFromEntities` | `addMany` / `removeMany` |
  | `addBundle(e, bundle)` | keep |

  `getData` / `setData` / `readDataInto` rather than `get` / `set` makes `world.components` and `world.relations`
  line up name for name. It also leaves `getInstance` unambiguous.

### 3. Queries and change detection

| | API |
| --- | --- |
| **Miski** | `new Query({ all, any, none, include })`, with arrays or keyed maps; `Query.compose(...)`. `world.entities.query(q)` returns a pooled iterator; `queryList(q)` returns a dense borrowed `{ count, entities, slots, each }`; `toArray(list)` copies it out. Change detection is per refresh window: `queryEntered(q)`, `queryExited(q)`, `components.getChanged(C)`, `relations.getChanged(R)` and `world.queryRevision(q)`. |
| bitECS | `query(world, [A, Not(B), Or(C, D)])` returns an id array; `registerQuery`. No `Added` / `Changed` filters: observers instead (`observe(world, onAdd(A), cb)`, `onRemove`, `onSet`). |
| Koota | `world.query(A, Not(B), Or(C))`, `queryFirst`, `createQuery`. Change filters are per-instance trackers (`createAdded()`, `createRemoved()`, `createChanged()`). Observers: `world.onAdd/onRemove/onChange`, `onQueryAdd/onQueryRemove`. |
| Becsy | `q.current.with(A).and.withAny(B).but.without(C).read`, plus reactive lists `q.added`, `q.removed`, `q.changed` and `q.addedOrChanged`. |
| miniplex | `world.with("a").without("b").where(fn)`, plus `onEntityAdded` / `onEntityRemoved` events. No changed filter. |
| flecs | Query builder `.with<T>()`, `.without<T>()`, `.or_()`, `.optional()`. `.detect_changes()` and `q.changed()` work per table. Observers: `OnAdd` / `OnSet` / `OnRemove`; monitors fire on query enter and exit. |
| Bevy | `Query<D, F>` with `With<T>`, `Without<T>`, `Or<...>`, `Added<T>`, `Changed<T>`, `Has<T>`. Observers on `Add` / `Insert` / `Remove` / `Despawn`. |

**Converge on:** and/or/not filters; change detection attached to the query or to an observer, not to the world.
Each consumer sees the changes made since it last ran. Miski's window model instead gives every consumer the same
window, which ends at `refresh()`.

**Recommendation:**

- Keep the `Query` spec and the `query` / `queryList` pair.
- Keep `queryEntered` / `queryExited` / `getChanged`. They are well-defined and documented.
- After 1.0, add per-query change filters (`changed: [C]` in the spec) or per-consumer trackers. Both are additive.
- `querySnapshot(q)` equalled `toArray(queryList(q))`, and `getActiveSnapshot` / `getChangedSnapshot` /
  `getOwnersSnapshot` equalled `Array.from(...)` over the pooled iterators. This branch removes them (D2).
- `Query`'s public `allEntries` / `anyEntries` / `noneEntries` / `includeEntries` / `dependencyComponents` are
  normalisation internals, used only by `src` and two tests (D8).

### 4. Systems and scheduling

| | API |
| --- | --- |
| **Miski** | `new System({ name, query, callback, argCount?, init?, destroy? })`. `world.systems.register/get/has/destroy/destroyOrThrow`. `new Schedule(world, { phases, fixedStep, maxFixedSteps })`, then `.add(system, { phase, before, after, runIf })`. Also `setEnabled`, `getOrder`, `run(dt)`, `getClock` / `setClock`, the allocation-free clock getters `tick` / `fixedTick` / `elapsed` / `accumulator`, and a shared `ScheduleContext`. |
| bitECS, Koota, miniplex | No system concept: systems are plain functions (bitECS `pipe`, Koota `createActions`). |
| Becsy | `class extends System`, with `this.schedule(s => s.before(X).after(Y))`, groups, entitlement-derived order and coroutines. No fixed step found. |
| ECSY / ape-ecs | System classes run in registration order; ape-ecs groups them. |
| flecs | `world.system<...>().kind(flecs::OnUpdate)`, with phases `OnLoad` through `OnStore`, custom phases, `DependsOn`, `.interval()` / `.rate()` and a `Disabled` tag. |
| Bevy | Schedules, `in_set`, `before`, `after`, `run_if`, `chain` and `FixedUpdate`. |

**Converge on** (where systems exist at all): named phases or schedules, `before` / `after`, run conditions and a
fixed-step schedule. These are Bevy's and flecs' features, and Miski has each one.

**Recommendation: keep.** `register` (renamed in beta.3) is clear. `argCount` is Miski-specific: it exists to make
calls allocation-free, it is documented, and it is typed. Keep it. The type requires `argCount` to equal the
callback's declared extra parameters, which a consumer tripped over (`argCount: 1` with a callback that leaves out
`ctx`); this branch documents the rule, and loosening it is D11.

### 5. Relations

| | API |
| --- | --- |
| **Miski** | `new Relation({ name, exclusive?, acyclic?, onDeleteTarget?: "remove" \| "cascade", schema? })`, registered like a component. `world.relations.add/remove/removeAll/has/hasAny/getTarget/getTargets/getSources/getAllTargets/queryList/getData/readDataInto/setData/getChanged/traverse/getInstance/getInstanceOrThrow`. |
| bitECS | `createRelation({ store, exclusive, autoRemoveSubject, onTargetRemoved })`, `Pair(R, t)`, `Wildcard`, `getRelationTargets`, `IsA`, plus hierarchy helpers (`queryHierarchy`, `getHierarchyDepth`). |
| Koota | `relation({ store, exclusive, autoDestroy: 'orphan' \| 'source' \| 'target' })`, `ChildOf(parent)`, `'*'`, `targetsFor` / `targetFor`, `ordered(...)`. |
| Becsy | `ref` and `backrefs` fields; no pair relations. |
| flecs | Pairs `(R, t)`, `Wildcard`, the `Exclusive` trait and cleanup pairs `(OnDeleteTarget, Delete \| Remove \| Panic)`. `ChildOf` is built in. |
| Bevy | `Relationship` / `RelationshipTarget` components, `ChildOf` / `Children` and `linked_spawn`. No wildcard. |

**Converge on:** exclusive vs multi-target, a delete policy for the target (remove the pair, or destroy the source), and
first-class hierarchies. Miski's `onDeleteTarget` is flecs' own name, and `"cascade"` is flecs' `Delete` and Koota's
`autoDestroy: 'orphan'`.

**Recommendation: keep.** Miski has no wildcard *query term* (`all: [ChildOf("*")]`). The relation tag already plays
that role: a plain query on `ChildOf` matches any target. A `(R, specific target)` query term would be additive; today
`relations.queryList(R, t, q)` covers it.

### 6. Command buffers and deferred operations

| | API |
| --- | --- |
| **Miski** | `new CommandBuffer(world)`: `spawn(bundle)` returns a `PendingEntity`; also `destroy`, `add`, `set`, `remove`, `relate`, `unrelate`, `flush()`, `clear()`, `pendingCount`. A `Schedule` flushes at each phase end. Commands for dead entities are skipped. A failing command does not stop the flush. |
| bitECS | No buffer; only deferred removals (`commitRemovals`). |
| Koota, miniplex, ECSY | None. |
| flecs | Stages and deferred mode; commands for deleted entities are discarded. |
| Bevy | `Commands`, with `ApplyDeferred` inserted automatically; failed commands go to an error handler. |

**Converge on** (Bevy and flecs): a spawn returns a usable id at once, commands flush at sync points, and commands for
dead targets are dropped rather than fatal. Miski matches all three.

**Recommendation: keep.** `CommandBuffer.instantiate(prefab, overrides?)` (A8, D10) is now on this branch. It
returns a `PendingEntity`, and relations are queued with `relate`.

### 7. Prefabs

| | API |
| --- | --- |
| **Miski** | `new Prefab({ name, extends?, components })` is a frozen definition that lives outside every world. Instantiate with `world.entities.instantiate/instantiateOrThrow/instantiateMany/instantiateManyOrThrow`. Overrides merge per field, and instances are plain copies. |
| bitECS | A `Prefab` component plus `IsA` inheritance. Prefabs are entities that queries exclude. |
| flecs | `world.prefab()`, `e.is_a(p)` and `OnInstantiate` (`Copy` / `Inherit` / `DontInherit`). Overrides work, and child subtrees are copied. |
| Bevy | No prefab type: scenes, bundles and required components fill the role. |
| Koota, Becsy, miniplex | Not found. |

**Converge on:** nothing strong. flecs and bitECS make prefabs world entities with live inheritance. Miski deliberately
copies (documented). That rules out "edit the prefab, every instance changes", but keeps prefabs out of queries,
capacity and saves.

**Recommendation: keep.** Keep `instantiateMany` separate from `instantiate`: it returns a borrowed list, not an
`Entity`, and Bevy (`spawn_batch`) and flecs (bulk) separate them too. This settles A4's "fold into
`instantiate(prefab, n?)`" with no change.

### 8. Serialization

| | API |
| --- | --- |
| **Miski** | `saveWorld(world, into?)` (binary, allocation-free into a reused buffer), `loadWorld(world, bytes, { migrate? })`, `readWorldSaveHeader`, `worldSaveLayout`, `worldSaveToDocument` / `worldSaveFromDocument` (lossless JSON-safe). Saves are versioned (`FORMAT_VERSION` 2) and the layout is checked. |
| bitECS | `createSoASerializer` / `createSnapshotSerializer` / `createObserverSerializer` with matching deserializers. Ids are remapped through a `Map`. No format version is documented. |
| ape-ecs | `world.getObject()` / `world.createEntities(array)` (plain objects). |
| flecs | `world.to_json()` / `world.from_json()`. No stability promise found. |
| Bevy | `DynamicWorld` / `serialize_ron` (reflect-based) and the new `bsn!` scenes. No format-stability statement; `Entity::to_bits` is explicitly not a wire format. |
| Koota, Becsy, miniplex | None found. |

**Converge on:** nothing. No surveyed library writes down a compatibility promise for saved data. Miski's
layout-checked, versioned binary format with a `migrate` hook is already more than the field offers. Write the promise
down: see [Save format stability](#save-format-stability).

### 9. Error model

| | Rule |
| --- | --- |
| **Miski** | Every library failure is a `MiskiError` subclass (`isMiskiError`). An absent *state* returns `undefined` / `false` from the plain name, and the `OrThrow` name throws: `create` / `createOrThrow`, `instantiate*`, `getInstance*`, `getEntityData*`, `relations.getInstance*`, `systems.destroy*`. Misuse throws: an unregistered definition, a dead entity passed to a mutation, a malformed argument, a bad lifecycle state. |
| bitECS (source) | Add or remove on a dead entity throws. `hasComponent` returns `false` and `getComponent` returns `undefined`, including for an unregistered component. Removing a dead entity is a no-op; adding a component that is already there returns `false`. No cap check. |
| Koota (source) | Adding a trait that is already there, or removing one that is absent, is a silent no-op. `has` / `get` return `false` / `undefined`. Destroying a dead entity throws. No cap check. |
| Becsy | The dev build throws on every violation (double delete, double add, missing entitlement, stale handle). The perf build skips the checks. |
| flecs | Asserts in debug builds; "application code does not need to check for errors". `try_get` returns a pointer. |
| Bevy | Plain calls panic. The checked form is `get_*` / `try_*` and returns `Option` / `Result`. Fallible systems and commands return `Result<(), BevyError>` to a configurable handler. |

**Converge on:** reads of absent data return an empty value, and misuse fails loudly. Naming differs. Bevy's default is
the strict call with a `try_` lenient form; Miski's default is the lenient plain name with an `OrThrow` strict form.
Both are consistent. Miski's is the JS convention (`Map.get` returns `undefined`). Keep it (D7).

**Recommendation: keep, and write the rule down.** The rule is now:

> A plain name returns `undefined` (or `false`) when the *state* it asks about is absent: a full world, a dead entity
> on a read, an entity that doesn't own the component, a missing pair, an unknown system name. Its `OrThrow` twin
> throws instead. Passing a definition the world doesn't have registered, a malformed argument, or a dead entity to a
> mutation always throws.

The probe before this change found these exceptions to the rule:

| Call | Before | After |
| --- | --- | --- |
| `components.getChanged(unregistered)` | `undefined` | throws `NotRegisteredError` (this branch) |
| `components.getOwners(unregistered)` | `undefined` | throws `NotRegisteredError` (this branch) |
| `components.entityHas(unregistered, e)`, now `has` | `false` | throws `NotRegisteredError` (this branch, D5) |
| `components.getInstance(unregistered)` | `undefined` | unchanged by design: it is the lookup, and `isRegistered` exists |

Already consistent: `relations.has/getChanged/getTarget(unregistered)` throw; `getEntityData(unregistered)` throws;
`getEntityData(dead)` returns `undefined`; `removeFromEntity(not owned)` is a no-op (now `getData` and `remove`); `destroy(dead)` throws
`EntityNotFoundError`.

### 10. Naming

| Concept | Miski | Field |
| --- | --- | --- |
| make / end an entity | `create` / `destroy` | `spawn` / `despawn` (Bevy), `spawn` / `destroy` (Koota), `addEntity` / `removeEntity` (bitECS), `createEntity` / `delete` (Becsy) |
| component verbs | `add` / `remove` / `has` / `getData` / `setData` (renamed by D1) | `add` / `remove` / `has` / `get` / `set` everywhere |
| strict vs lenient | `x` / `xOrThrow` | `try_x` / `x` (Bevy), `try_get` / `get` (flecs) |
| copy-out helpers | `toArray`, `Array.from` (the `*Snapshot` helpers went in D2) | Koota `world.entities` is a copy; others return arrays directly |
| relation verbs | `add` / `remove` / `has` / `getTarget(s)` / `getSources` | `add(R(t))` / `targetFor` / `targetsFor` (Koota); `getRelationTargets` (bitECS) |
| definitions | `new Component` / `new Relation` / `new Prefab` / `new Query` / `new System` | factories (`trait()`, `relation()`, `createRelation`) or classes |
| typed façade | `createEcsWorld` / `EcsWorld` | none of the others has two world types (D4) |

## Backlog: A1–A11 from the beta.3 review

The status comes from the beta.3 CHANGELOG section, checked against the code at `be0dee2`. The review itself is
`docs/review-beta.3.md` on branch `agent/loadworld-gc-budget`.

| Item | Status | What is left |
| --- | --- | --- |
| A1 One way to construct | Done | — |
| A2 One throw-vs-undefined rule | Done for `world.components`, `world.relations`, `world.systems`, `world.entities` and `EcsWorld` | `entityHas(unregistered)` returns `false` (D5). `getChanged` / `getOwners(unregistered)` returned `undefined`: fixed on this branch. |
| A3 Collapse the query surface | Done: `queryEntities`, `queryComponents` and the `archetypes` namespace are gone, `queryEntered` / `queryExited` moved to `entities`, `toArray` is typed | — (`querySnapshot` removed by D2) |
| A4 Entity creation | Done: `createWith*` folded into `create(bundle?)`, `isEntity` removed | `instantiateMany` stays separate, by recommendation (see §7) |
| A5 Component read/write tiers | Done | — |
| A6 Rollback styles | Done: `WorldRollbackScope` is the one API | — |
| A7 Save API | Done | — |
| A8 Relations, commands, scheduling | Done: `remove` needs a target, `queryList` takes the relation first, `CommandBuffer.relate` / `unrelate` exist, `Schedule.add`'s `argCount` is typed, `systems.register` is documented | `CommandBuffer.instantiate(prefab)` is not implemented. It is additive, so it can come after 1.0. |
| A9 Errors | Done: everything is a `MiskiError`, `NoComponentsFoundError` is gone, the `maxOwnersError` helper exists | — |
| A10 Trim exports | Done for `isValid*`, `mergeComponentSchemas`, `ParametersExceptFirstTwo`, `StorageCell`, `PartitionStorage`, `SchemaValues` and `WorldContext` | `StorageProxyWithProperties`, `CompiledComponentEntry` and `CompiledComponentProperty` stay: public signatures use them, and `deno doc --lint` requires them. Optional tidy: `createComponentRegistry` is still `export`ed inside `src` for one caller. |
| A11 Naming | Done: `maxOwners`, the internal slot/entity names and the query-pool file | — |

## Proposed 1.0 surface

"keep" means frozen at 1.0. "keep\*" means keep, but the value or layout depends on an open decision (D9).
"removed", "renamed" and "hidden" record the decisions implemented on this branch.

### Members

`World`:

| Member | 1.0 |
| --- | --- |
| `entities`, `components`, `relations`, `systems` | keep |
| `state`, `init()`, `onReady()`, `destroy()`, `[Symbol.asyncDispose]` | keep |
| `refresh(retainChanged?, retainTransitions?)`, `frame(fn)` | keep |
| `queryRevision(q)` | keep |
| `captureCheckpoint(entities, ...components)`, `applyCheckpoint(cp)` | keep |

`world.entities`:

| Member | 1.0 | Note |
| --- | --- | --- |
| `capacity`, `create`, `createOrThrow`, `destroy`, `isActive`, `isEmpty` | keep | |
| `getActive`, `getActiveCount`, `getAvailableCount` | keep | |
| `query`, `queryList`, `queryEntered`, `queryExited`, `toArray` | keep | |
| `instantiate`, `instantiateOrThrow`, `instantiateMany`, `instantiateManyOrThrow` | keep | |
| `querySnapshot`, `getActiveSnapshot` | removed | D2: `toArray(queryList(q))` / `Array.from(getActive())` |

`world.components`:

| Member | 1.0 | Note |
| --- | --- | --- |
| `count`, `registry`, `isRegistered`, `getInstance`, `getInstanceOrThrow`, `query`, `markChanged` | keep | |
| `add`, `remove`, `has`, `getData`, `getDataOrThrow`, `setData`, `readDataInto`, `addMany`, `removeMany` | renamed | D1: were `addToEntity`, `removeFromEntity`, `entityHas`, `getEntityData`, `getEntityDataOrThrow`, `setEntityData`, `readEntityDataInto`, `addToEntities`, `removeFromEntities`; `has` throws for an unregistered component (D5) |
| `addBundle` | keep | |
| `getChanged`, `getOwners` | keep | throw for an unregistered component (this branch) |
| `getChangedSnapshot`, `getOwnersSnapshot` | removed | D2: `Array.from(getChanged(C))` / `Array.from(getOwners(C))` |
| `getInstances` | removed | this branch: internal plumbing |

`world.relations`: keep every member (`add`, `remove`, `removeAll`, `has`, `hasAny`, `getTarget`, `getTargets`,
`getSources`, `getAllTargets`, `queryList`, `getData`, `readDataInto`, `setData`, `getChanged`, `traverse`,
`getInstance`, `getInstanceOrThrow`).

`world.systems`: keep `registry`, `register`, `get`, `has`, `destroy` and `destroyOrThrow`.

`ComponentInstance`: keep `id`, `name`, `type`, `storage`, `proxy`, `revision`, `has`, `markChanged`, `get` and
`set`.

`Schedule`: keep `phases`, `fixedStep`, `maxFixedSteps`, `accumulator`, `tick`, `fixedTick`, `elapsed` (the last
three added on this branch), `context`, `commands`, `add`, `remove`,
`has`, `setEnabled`, `isEnabled`, `getOrder`, `run`, `getClock` and `setClock`.

`CommandBuffer`: keep `pendingCount`, `spawn`, `destroy`, `add`, `set`, `remove`, `relate`, `unrelate`, `flush` and
`clear`, plus `instantiate` (D10, added on this branch).

`EcsWorld`: keep `world`, `components`, `storage`, `relations`, `capacity`, `init`, `query`, `spawn`, `spawnOrThrow`,
`prefab`, `instantiate`, `instantiateOrThrow`, `instantiateMany`, `instantiateManyOrThrow` and `frame`. See D4 for the
name.

`Query`: keep `all`, `any`, `none`, `include` and `Query.compose`. `allEntries`, `anyEntries`, `noneEntries`,
`includeEntries` and `dependencyComponents` are hidden (D8): they left the public `Query` type.

### Every export

<!-- 173 exports, generated from deno doc --json mod.ts -->

#### World and lifecycle

| Export | Kind | 1.0 | Note |
| --- | --- | --- | --- |
| `World` | class | keep |  |
| `WorldSpec` | type | keep |  |
| `WorldState` | type | keep |  |
| `WorldContext` | type | keep |  |
| `MAX_WORLD_CAPACITY` | variable | keep* | value may change with the entity-cap work (decision D9) |
| `WorldEntityAPI` | type | keep |  |
| `WorldComponentAPI` | type | keep | members: see the member tables |
| `WorldRelationAPI` | type | keep |  |
| `WorldSystemAPI` | type | keep |  |

#### Entities

| Export | Kind | 1.0 | Note |
| --- | --- | --- | --- |
| `Entity` | type | keep |  |
| `SlotIndex` | type | keep |  |
| `asEntity` | function | keep |  |
| `asSlotIndex` | function | keep |  |
| `entityIndex` | function | keep |  |
| `entityGeneration` | function | keep |  |
| `packEntity` | function | keep* | bit layout may change with the entity-cap work (D9) |
| `BorrowedEntityIterator` | type | keep |  |
| `BorrowedEntityList` | type | keep |  |
| `BorrowedEntityListEachFn` | type | keep |  |
| `BorrowedEntityIndices` | type | keep |  |
| `BorrowedSlotIndices` | type | keep |  |
| `QueryEntityList` | type | keep |  |

#### Components, schemas and fields

| Export | Kind | 1.0 | Note |
| --- | --- | --- | --- |
| `Component` | interface+variable | keep |  |
| `ComponentConstructor` | interface | keep |  |
| `ComponentSpec` | type | keep |  |
| `InferredDataComponentSpec` | type | keep |  |
| `TagComponentSpec` | type | keep |  |
| `ComponentInstance` | class | keep | type-only export |
| `StorageProxy` | class | keep | type-only export |
| `StorageProxyWithProperties` | type | keep | type of `ComponentInstance.proxy` |
| `ComponentStorage` | type | keep |  |
| `ComponentPartitions` | type | keep |  |
| `ComponentData` | type | keep |  |
| `ComponentValue` | type | keep |  |
| `ComponentRecord` | type | keep |  |
| `ComponentInstances` | type | keep |  |
| `ComponentMap` | type | keep |  |
| `DynamicComponent` | type | keep |  |
| `DynamicComponentInstance` | type | keep |  |
| `ComponentBundle` | type | keep |  |
| `ComponentBundleEntryFor` | type | keep |  |
| `ComponentBundleEntryInput` | type | keep |  |
| `Schema` | type | keep |  |
| `SchemaOrNull` | type | keep |  |
| `SchemaPropertyArray` | type | keep |  |
| `FieldSchema` | type | keep |  |
| `ComponentSchema` | type | keep |  |
| `ComponentFieldSpec` | type | keep |  |
| `defineComponentSchema` | function | keep |  |
| `TypedArray` | type | keep |  |
| `TypedArrayConstructor` | type | keep |  |
| `field` | variable | keep |  |
| `FieldFactory` | interface | keep |  |
| `FieldDescriptor` | type | keep |  |
| `FieldKind` | type | keep |  |
| `FieldRaw` | type | keep |  |
| `FieldValue` | type | keep |  |
| `BoolField` | interface | keep |  |
| `EntityField` | interface | keep |  |
| `EnumField` | interface | keep |  |
| `StringField` | interface | keep |  |
| `ObjectField` | interface | keep |  |
| `ObjectFieldOptions` | interface | keep |  |
| `ObjectFieldEncoded` | type | keep |  |
| `isFieldDescriptor` | function | keep |  |
| `cloneFieldValue` | function | keep |  |
| `canonicalizeStoredValue` | function | removed | internal write helper that takes a scratch typed array; no README use (D3) |

#### Queries

| Export | Kind | 1.0 | Note |
| --- | --- | --- | --- |
| `Query` | interface+class | keep | consider hiding `*Entries` / `dependencyComponents` (D8) |
| `QueryConstructor` | interface | keep |  |
| `QuerySpec` | type | keep |  |
| `TypedQuerySpec` | type | keep |  |
| `QueryInputSpec` | type | keep |  |
| `QueryComponents` | type | keep |  |
| `ComposedQueryComponents` | type | keep |  |
| `UntypedQueryComponents` | type | keep |  |
| `NormalizedQueryComponentEntry` | type | removed | only needed while `Query.*Entries` were public (D8) |

#### Systems and scheduling

| Export | Kind | 1.0 | Note |
| --- | --- | --- | --- |
| `System` | class | keep |  |
| `SystemSpec` | type | keep |  |
| `SystemArgCount` | type | keep |  |
| `SystemCallback` | type | keep |  |
| `TypedSystemCallback` | type | keep |  |
| `SystemFunction` | type | keep |  |
| `SystemInstance` | type | keep |  |
| `SystemRecord` | type | keep |  |
| `SystemHook` | type | keep |  |
| `SystemHookContext` | type | keep |  |
| `Schedule` | class | keep |  |
| `ScheduleSpec` | type | keep |  |
| `SchedulePhaseSpec` | type | keep |  |
| `ScheduleSystemOptions` | type | keep |  |
| `ScheduleSystemReference` | type | keep |  |
| `ScheduleContext` | interface | keep |  |
| `ScheduleClock` | type | keep |  |
| `CommandBuffer` | class | keep |  |
| `CommandBundle` | type | keep |  |
| `CommandBundleEntryFor` | type | keep |  |
| `CommandData` | type | keep |  |
| `PendingEntity` | type | keep |  |

#### Relations

| Export | Kind | 1.0 | Note |
| --- | --- | --- | --- |
| `Relation` | interface+variable | keep |  |
| `RelationConstructor` | interface | keep |  |
| `RelationSpec` | type | keep |  |
| `RelationSpecBase` | type | keep |  |
| `TagRelationSpec` | type | keep |  |
| `DataRelationSpec` | type | keep |  |
| `RelationDeletePolicy` | type | keep |  |
| `isRelation` | function | keep |  |
| `AnyRelation` | type | keep |  |
| `RelationInstance` | type | keep |  |
| `RelationDataInput` | type | keep |  |
| `BorrowedRelationList` | type | keep |  |
| `BorrowedHierarchyList` | type | keep |  |

#### Prefabs

| Export | Kind | 1.0 | Note |
| --- | --- | --- | --- |
| `Prefab` | class | keep |  |
| `PrefabSpec` | type | keep |  |
| `PrefabDefaults` | type | keep |  |

#### Typed named-map world (`createEcsWorld`)

| Export | Kind | 1.0 | Note |
| --- | --- | --- | --- |
| `createEcsWorld` | function | keep |  |
| `EcsWorld` | class | keep |  |
| `EcsWorldConfig` | type | keep |  |
| `EcsPrefabOptions` | type | keep |  |
| `SpawnSpec` | type | keep |  |
| `RegistryFromMaps` | type | keep |  |
| `SchemaComponentMap` | type | keep |  |
| `TagMap` | type | keep |  |
| `TagSpec` | type | keep |  |
| `TagsFromMap` | type | keep |  |
| `StorageFromMap` | type | keep |  |
| `DataStorageFromMap` | type | keep |  |
| `TagStorageFromMap` | type | keep |  |
| `ComponentsFromSchemaMap` | type | keep |  |
| `RelationMap` | type | keep |  |
| `RelationOptions` | type | keep |  |
| `RelationsFromMap` | type | keep |  |
| `compileComponentSchema` | function | keep |  |
| `componentSchemaHash` | function | keep |  |
| `CompiledComponentSchema` | type | keep |  |
| `CompiledComponentEntry` | type | keep | type of `CompiledComponentSchema.entries` |
| `CompiledComponentProperty` | type | keep | type of `CompiledComponentEntry.properties` |

#### Checkpoints and rollback

| Export | Kind | 1.0 | Note |
| --- | --- | --- | --- |
| `ComponentCheckpoint` | interface | keep |  |
| `CheckpointEntitySet` | type | keep |  |
| `WorldRollbackScope` | class | keep |  |

#### World saves

| Export | Kind | 1.0 | Note |
| --- | --- | --- | --- |
| `saveWorld` | function | keep |  |
| `loadWorld` | function | keep |  |
| `readWorldSaveHeader` | function | keep |  |
| `worldSaveLayout` | function | keep |  |
| `worldSaveToDocument` | function | keep |  |
| `worldSaveFromDocument` | function | keep |  |
| `WorldSaveError` | class | keep |  |
| `WorldSaveHeader` | type | keep |  |
| `WorldSaveLoadOptions` | type | keep |  |
| `WorldSaveLayout` | type | keep |  |
| `WorldSaveComponentLayout` | type | keep |  |
| `WorldSaveRelationLayout` | type | keep |  |
| `WorldSaveField` | type | keep |  |
| `WorldSaveFieldType` | type | keep |  |
| `WorldSaveNumericFieldType` | type | keep |  |
| `WorldSaveDocument` | type | keep |  |
| `WorldSaveComponentDocument` | type | keep |  |
| `WorldSaveRelationDocument` | type | keep |  |
| `WorldSaveRelationPair` | type | keep |  |
| `WorldSaveFieldValues` | type | keep |  |
| `WorldSaveNumber` | type | keep |  |
| `WorldSaveObjectValue` | type | keep |  |

#### Errors

| Export | Kind | 1.0 | Note |
| --- | --- | --- | --- |
| `MiskiError` | class | keep |  |
| `isMiskiError` | function | keep |  |
| `SpecError` | variable | keep |  |
| `ArgumentError` | variable | keep |  |
| `ComponentDataError` | variable | keep |  |
| `CapacityError` | variable | keep |  |
| `EntityNotFoundError` | variable | keep |  |
| `NotRegisteredError` | variable | keep |  |
| `AlreadyRegisteredError` | variable | keep |  |
| `ComponentOwnershipError` | variable | keep |  |
| `RelationCycleError` | variable | keep |  |
| `WorldStateError` | variable | keep |  |

## Save format stability

Two things version independently:

- **The format version** (`FORMAT_VERSION`, now 2) covers how the library lays out bytes and the document shape. It
  is the library's responsibility.
- **The layout** (`worldSaveLayout(world)`: capacity, components in order, their fields, storage types and caps,
  and relation options) is the application's schema. It is the user's responsibility, through `migrate`.

`loadWorld` checks the format version first and rejects a mismatch before `migrate` can run. `migrate` only ever
handles layout differences.

**The promise, from 1.0.0:**

1. **Reading.** Every 1.x release loads every save and every save document written by any 1.x release from 1.0.0
   on. If a later 1.x release needs a new format version, it keeps reading the older versions, converting on load.
   It does not ask the application to convert.
2. **Writing.** A release writes the newest format version it knows. An older release rejects a newer save with a
   `WorldSaveError` that names both versions. It never misreads it. Saves are not forward-compatible.
3. **Bumps.** The format version changes only when the bytes or the document shape change. It does not change for
   unrelated library releases. A bump is a minor release, never a patch, and the CHANGELOG says so.
4. **Determinism.** Within one format version, the same world state saves to the same bytes.
5. **Layout.** A save loads only into a world with the same layout. Otherwise `migrate` receives the save as a
   `WorldSaveDocument` with the target layout, and its result is validated like any other save. `WorldSaveDocument`
   and `WorldSaveLayout` are public types and keep the semver promise of the rest of the API: 1.x changes to them
   are additive only.
6. **Schema hashes.** `componentSchemaHash` / `compileComponentSchema(...).schemaHash` and the save's
   `layoutHash` stay the same across 1.x for the same schema.
7. **Pre-1.0 saves.** Saves written by `1.0.0-beta.x` carry format version 2. If 1.0.0 still writes version 2, they
   load. If the freeze changes the format (see D9), 1.0.0 starts at version 3 and rejects beta saves.

Not promised: compatibility with 0.x saves (there were none in this format); loading a save into a different layout
without `migrate`; preserving raw writes to slots that do not own a component; NaN payload bits through the document.

**Why this shape.** No surveyed library makes a written promise for saved data. Bevy says outright that
`Entity::to_bits` is not a wire format, and flecs' and bitECS' serializers carry no version. Retail games need saves
to survive patches. "Every 1.x reads every older 1.x" is the minimum a game can ship on. It also costs little: the
format already has a version word, a required-section flag for unknown sections, and a structural validator.

**Blocker before freezing.** The entity-cap research may widen `Entity` packing or the capacity range. Either one
changes the bytes: generations are saved per slot at their current width, and `field.entity()` cells are saved
as packed handles. Settle D9
first, then freeze `FORMAT_VERSION` at whatever 1.0.0 writes.

## Consumer feedback: the Hive showcase game

Hive is a game built on beta.3. Its findings, relayed from another session:

| Finding | Status |
| --- | --- |
| `Schedule.getClock()` allocates a new object (about 62 B) on every call, and Hive reads the tick every frame | Fixed on this branch: `schedule.tick`, `fixedTick` and `elapsed` getters join `accumulator`. `getClock()` stays for save and restore. |
| `CommandBuffer.spawn` takes bundles only, so spawning from a prefab inside a system means calling `entities.instantiate` after the borrowed list is done | D10 |
| `argCount: 1` is a type error for a callback that leaves out `ctx` | Documented on this branch; loosening is D11 |
| Scheduler, prefab and relation docs exist only in the README; the fixed-phase caveat about entered / exited / changed windows is easy to miss | D12 |
| A git checkout can't be imported from another project without a hand-written import map | CONTRIBUTING now shows Deno `links`, tested against this branch |
| Deno's 24-hour minimum dependency age blocked beta.3 and `partitionedbuffer` 0.5.0 for new consumers on publish day | CONTRIBUTING's release steps now say to publish dependency bumps a day early |

Hive also reports that relations round-trip through saves, the same seed gives byte-identical saves, the fixed-phase
schedule dropped no ticks over 100k ticks, and a 5k-creature tick takes about 1.2 ms.

## Decisions for the maintainer

Each one is a naming call, the removal of something callers can use, or a new capability. The maintainer accepted
every recommendation below. On this branch:

- **Implemented:** D1 (rename), D2 (snapshot helpers removed), D3 (`canonicalizeStoredValue` unexported), D5
  (`entityHas` / `has` throws), D8 (Query internals hidden), D10 (`CommandBuffer.instantiate`) and D12 (guide links
  in the module docs).
- **Kept as they are:** D4, D6, D7 and D11.
- **Still open:** D9. The entity-cap research recommends keeping the cap for 1.0 but making the handle helpers world-bound or internal first.

Usage counts are `rg -w` hits in `src` / `test` / `bench`+`example` / README+`mod.ts`, taken before the changes.

| # | Decision | Recommendation | Cost |
| --- | --- | --- | --- |
| D1 | Rename the `world.components` verbs to `add` / `remove` / `has` / `getData` / `getDataOrThrow` / `setData` / `readDataInto` / `addMany` / `removeMany` (map in §2) | **Do it.** It is the one place Miski diverges from every surveyed library and from its own `relations` / `ComponentInstance`, and 1.0 is the last cheap moment. | About 750 call sites (`addToEntity` 6/296/99/9, `getEntityDataOrThrow` 5/182/5/6, `setEntityData` 6/71/8/8, `entityHas` 6/57/4/2, `removeFromEntity` 4/61/17/3, …). Mechanical. |
| D2 | Remove the `*Snapshot` helpers (`querySnapshot`, `getActiveSnapshot`, `getChangedSnapshot`, `getOwnersSnapshot`) in favour of `toArray(list)` and `Array.from(iterator)` | Lean remove. They are one-liners that allocate, and the zero-allocation story reads better without them. Keeping them costs nothing at runtime. | 8 src, 55 test, 22 bench/example |
| D3 | Stop exporting `canonicalizeStoredValue` | Remove. It is an internal write helper that needs a caller-supplied scratch typed array. The guarded write paths already apply it. | 7 test uses (they can import from `src`) |
| D4 | `createEcsWorld` / `EcsWorld` naming ("Ecs" in an ECS library) | Keep. Renaming (`TypedWorld`?) churns 41 tests and 12 doc mentions for little gain. Say if you want it. | — |
| D5 | `components.entityHas(unregistered, e)`: keep returning `false`, or throw `NotRegisteredError` like `relations.has` | Throw. It is the last exception to the written rule, and `isRegistered` covers the "maybe registered" case. Against: bitECS and Koota `has` return `false` for unregistered. | Behaviour change, no type change |
| D6 | Fold `instantiateMany` into `instantiate(prefab, n?)` (review A4) | Don't. Different return types; Bevy and flecs keep bulk spawn separate. | — |
| D7 | Flip the strict/lenient default (`create` throws, `tryCreate` returns `undefined`), Bevy-style | Don't. The current `x` / `xOrThrow` rule is applied everywhere since beta.3 and matches JS (`Map.get`). | — |
| D8 | Hide `Query.allEntries` / `anyEntries` / `noneEntries` / `includeEntries` / `dependencyComponents` (and then `NormalizedQueryComponentEntry`) | Hide (`@internal`). They are normalisation internals; `all` / `any` / `none` / `include` remain. | 2 test uses |
| D9 | Entity-cap work: whether `Entity` packing, `MAX_WORLD_CAPACITY` or `packEntity` change before 1.0 | The research (`docs/limits-research.md` on `agent/lift-limits-878485`) says keep the 65,536 cap for 1.0 and lift it later behind a per-world option. To keep that later change non-breaking, it asks for one pre-1.0 change: make `entityIndex` / `entityGeneration` / `packEntity` world-bound (for example `world.entities.slotOf(e)`) or internal, and document handles as opaque per-world numbers. Still open: `entityIndex` is the documented hot-path slot lookup (README, `mod.ts` examples), so this changes how callers index storage. A per-world layout with runtime masks cost 7–32% on handle-decoding paths in that research. | 91 src / 109 test / 22 bench+example+docs uses |
| D10 | Let a `CommandBuffer` spawn from a `Prefab` (Hive asked for `spawn(prefab, overrides?, relationPairs?)`) | Add `commands.instantiate(prefab, overrides?)` returning a `PendingEntity`, mirroring `entities.instantiate`. Don't overload `spawn`, and don't add relation pairs: `commands.relate(pending, R, target)` already accepts pending handles on both ends. | New method on `CommandBuffer`; additive |
| D11 | Let `argCount` exceed the callback's declared extra parameters (so `argCount: 1` works with `(components, entities) => ...`) | Lean keep strict. The current rule is deliberate and type-tested, and `0` is the right value for a callback that ignores `ctx`; this branch documents it in the README and the `argCount` doc. Loosening is non-breaking if you prefer it. | Type change in `SystemSpec`; flips two `@ts-expect-error` cases in `test/typed_system_inference.ts` |
| D12 | Per-feature guides (scheduler, prefabs, relations) beyond the README, or README anchors linked from the JSR module docs | Anchors from `mod.ts` first; guides can follow 1.0. | Docs only |

## Additive work that does not block a freeze

These add API without changing existing calls, so they can ship in 1.x:

- Per-query change filters (`changed: [C]`, `added` / `removed` trackers), the field's common model.
- Observers (`onAdd` / `onRemove` / `onSet`), offered by bitECS, Koota, flecs and Bevy.
- A `(relation, target)` query term.

## Follow-up bug found while auditing

`world.components.getOwners(C)` and `getChanged(C)` return one shared iterator per component. Nested loops over the
same component therefore see too few pairs: 3 owners nested give 3 pairs, not 9. This is the hazard beta.3 fixed for
`entities.query()` and `getActive()` with pooled iterators. The return type (`BorrowedEntityIterator`) does not need
to change for the fix. It is fixed on `fix/pooled-component-iterators` (`112b36f`), which branches from this one.
