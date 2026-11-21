# Tests

Runtime tests live in `*.test.ts` files and run via `deno test` (see `deno.json` `test.include`).

## Domain map

| File | Covers |
| --- | --- |
| `ecs_gameplay_contracts.test.ts` | Happy-path gameplay: capacity, systems, queries, batch transitions, multi-world |
| `ecs_validation_contracts.test.ts` | Spec rejection and registry consistency |
| `errors.test.ts` | `isMiskiError` holds for schema, field, prefab, component data, capacity, relation and schedule failures |
| `system_call_forwarding.test.ts` | System call args: exact arity, rest params, defaults (also before a rest param), return values and promises, `argCount` fixed-arity forwarding and validation, registry lookups ignoring inherited keys |
| `world_api_conveniences.test.ts` | Soft reads, upserts, `createOrThrow`, iterable `queryList`, `world.frame`, `queryRevision`, `createEcsWorld` spawn, storage and tags |
| `schema_hash.test.ts` | `compileComponentSchema` / `componentSchemaHash`: key-order stability, tags and `maxOwners` in the hash, no component identities allocated, shared bootstrap validation |
| `module_graph.test.ts` | Forbidden import coupling edges |
| `component_integrity.test.ts` | Guarded identities, numeric writes and `canonicalizeStoredValue`, reserved schema fields, capped defaults, invalid and inherited-key payloads, inactive / unregistered / tag / non-owner access, batch add and remove atomicity, `getInstanceOrThrow`, raw storage as an unguarded escape hatch |
| `component_field_types.test.ts` | `field.*` bool / enum / entity / string / object fields: layout, defaults, validation, proxy, rollback, checkpoints, copy |
| `world_integrity.test.ts` | Atomic spawn/checkpoints, historical exits, rollback identities, slot bounds |
| `world_lifecycle_integrity.test.ts` | Async readiness, teardown concurrency, failure cleanup, `await using` disposal during destroy, in-flight init and failed init, a failed refresh blocking lifecycle APIs, `onReady` after destroy |
| `rollback_scope.test.ts` | `WorldRollbackScope` with `using`: restore when left without `commit()` (also on throw), commit, explicit restore, disposal on destroyed and errored worlds |
| `float16_column.test.ts` | `Float16Array` columns: writes, canonicalization, saves, documents, rollback; in a worker without the `Float16Array` global (`no_float16_worker.ts`), the import, an f32 save round-trip, and f16 saves rejected (`deno task test` grants `--allow-read` for `mod.ts`, `src` and the worker so it can load them) |
| `rollback_checkpoint_integrity.test.ts` | Checkpoint capture/apply and rollback restore/commit round-trips, one rollback scope, closed and per-world rollback scopes, foreign checkpoints, >32-component round-trips |
| `component_storage_integrity.test.ts` | Capped (dense-row) storage under stray non-owner writes, ownership acquisition, cap clamping, `maxOwners` limits and slot reuse, mixed-width schemas, column constructors, archetype storage scaling with population rather than capacity |
| `component_rollback_memory.test.ts` | Capped owners and dense rows through rollback and removal, sparse changed window, `getActive` scratch growth, 16-bit-capacity rollback |
| `component_tracking_regressions.test.ts` | Changed marking for newly owned components and `setData`, ownership-guarded `markChanged`, `readDataInto` leaving `out` alone on false, `applyCheckpoint` during `getOwners` iteration, failed bundle spawns stripping committed components |
| `component_write_regressions.test.ts` | `instance.set` leaves the shared proxy cursor alone across every field kind, changed marking and revision per real write, `[Ctor, initial]` tuples rejected with `SpecError` |
| `entity_slot_reuse.test.ts` | Generational handles, next-fit slot reissue, churn rotation, stale handles not reissued, generation wrap limit |
| `query_matching.test.ts` | Which entities a query matches: `any` / `none` clauses, none-only queries and the root archetype, destroyed entities, late-registered queries, unregistered components, `include` roles and validation, alias keys and immutable metadata, `Query.compose` |
| `query_result_cache.test.ts` | Cached query results: order and generations through moves, batches and rollback, refills only for related changes (by copying handles), retained buffers, buffer growth, component-query access not freshening stale results |
| `query_iteration.test.ts` | Per-call `query()` / `getActive()` iterators: nested loops (same and different queries, different bounds), pool reuse, destroy or remove during `query()` / `queryList()` / `getActive()` iteration, `getActive` bound validation |
| `query_transition_integrity.test.ts` | Atomic bundle spawn and `addBundle` preflight, entered/exited relative to the refresh window (also after rollback and new query registration), cached results updating on transitions, nested transition iteration |
| `rollback_neutrality.test.ts` | Committing or restoring a rollback scope leaves allocation cursor and iteration order untouched; rollback cost does not scale with capacity |
| `randomized_model.test.ts` | Seeded random operations checked against a plain model, with a twin control world proving rollback leaves no trace |
| `spawn_scratch_reuse.test.ts` | `EcsWorld.spawn` scratch reuse: no leaked components or data, undefined-skip and tag validation, re-entrant spawns from getters |
| `system_lifecycle_regressions.test.ts` | Init and destroy hooks awaiting `systems.destroy` reject instead of deadlocking; teardown rejects instead of throwing |
| `prefab.test.ts` | Prefab definition, `extends` flattening, instantiate / instantiateMany differential against `create(bundle)`, atomicity, capped components, rollback, `EcsWorld` helpers |
| `prefab_field_types.test.ts` | Prefabs with `field.*` columns: logical defaults, null-only entity refs, per-instance `create()` / `clone`, rejection of shared objects, throwing hooks, a `create()` hook that instantiates not corrupting the caller's list |
| `relations.test.ts` | Relations: pairs, order, data (undefined as absent), exclusive/acyclic, cleanup and cascades, traversal, guards, checkpoints and rollback (also with field columns), prefabs rejecting relations, `createEcsWorld` |
| `relations_model.test.ts` | Seeded random relation operations (including cascades and rollback) checked against a plain-array model |
| `schedule.test.ts` | `Schedule`: phase and constraint order, cycles, fixed timestep, context, run conditions, refresh and error semantics, per-phase command flushes, clock save/restore with rollback |
| `command_buffer.test.ts` | `CommandBuffer`: deferred spawn/destroy/add/set/remove, pending handles, partial payloads, inactive targets, drain-on-error flushes, wide and non-numeric fields, every field kind at flush, dead entity refs written as null, prefab default parity, growth |
| `command_buffer_relations.test.ts` | `CommandBuffer` relate/unrelate (pending entities at either end, skipped dead ends, queue-time validation, annotated failures), relation components rejected when queued, and pending entities as `field.entity()` values |
| `slot_set.test.ts` | `SlotSet`: lazy allocation, doubling growth up to its maximum, swap-remove, clear and assign without stale members |
| `slot_allocator.test.ts` | `SlotAllocator`: next-fit acquire and wrap, -1 when full, no-op release, clamped `occupiedIndicesInto`, live vs copied words, `restore` masking, cursor validation and replay |
| `relation_list.test.ts` | `RelationList`: parallel entity / slot / row / depth buffers, doubling growth capped at capacity, 8- vs 16-bit slots, `clear`, reusable `iterate()`, `each()`, nested iteration |
| `transition_window.test.ts` | `TransitionWindow`: first touch wins, stale and untouched handles have no origin, first-touch order, `clear`, `capture` / `restore` as an independent copy |
| `field_codec.test.ts` | Field codecs: which descriptors lower to bool / enum / entity, side-field defaults, encode validation and error messages, decoding dead references as `null`, side-value validation |
| `world_save.test.ts` | Whole-world saves: twin-world load differential, `saveWorld` into a reused buffer, header/layout, mismatch and migrate, corruption fuzz (random bytes, every header/layout bit, seeded bit flips in a world with every column kind and relations), JSON round-trip, no aliasing |
| `world_save_fields.test.ts` | World saves of `field.*` columns: string and object round-trips, encode/decode hook rules, null objects, missing hooks, throwing decode leaves the world untouched, unencodable strings, bool/enum/entity round-trips and range checks, field tags in layouts, label-order and kind mismatches, masked next generations, documents, corruption fuzz, continued behavior |
| `world_save_relations.test.ts` | World saves of relations: twin-world differential (getTargets / getSources / traverse order, rows, changed, continued behavior, byte-identical re-saves), load over a busy world, layout entries and option mismatches, JSON shape and round-trip, document rejections, binary target checks, relation-section corruption fuzz, `saveWorld` into a reused buffer and migrate |
| `release_integrity.test.ts` | Runtime, `deno.json`, README install snippet, and CHANGELOG version consistency (reads `README.md` and `CHANGELOG.md`; `deno task test` grants `--allow-read` for those two files, plus `mod.ts`, `src` and `no_float16_worker.ts` for the `float16_column.test.ts` worker) |

## Shared fixtures

`fixtures.ts` provides common ECS setup helpers used across test files:

- `vec2Component(name?, options?)` — `{ x, y }` schema component
- `tagComponent(name, options?)` — tag (null-schema) component
- `createEntity(world)` — create an entity and assert success
- `createTestWorld(components, capacity?)` — construct, init, and return a world
- `gameComponents()` — grid-game components (`GridPos`, `Facing`, `Drawable`, `Health`, `Door`) with branded value types
- `Mesh` — a stand-in object-field value

Tests import the public API from `../mod.ts`. Helpers that are not public (`mergeComponentSchemas`,
`isValidComponentSpec`, manager classes) are imported from their `../src/` module.

Assertion helpers live in `helpers.ts`. `assertEquals` compares structurally (`Object.is` for primitives, so `NaN`
equals `NaN` and `-0` differs from `0`; element-wise for arrays and typed arrays; a missing key differs from an
`undefined` one).

## Compile-only checks

These files are type-checked by `deno task check` but are **not** executed by `deno test`:

- `typed_system_inference.ts` — `new System` / `new Query` callback, query-map and `argCount` inference
- `query_constructor_inference.ts` — typed `Query({ all: { … } })` constructor inference
- `typed_ecs_world_inference.ts` — `createEcsWorld` / schema-world spawn and storage inference
- `entity_api_inference.ts` — slot bounds reject packed entity handles
- `field_type_inference.ts` — `field.*` value, payload, proxy and partition types
- `prefab_inference.ts` — `Prefab` definitions, instantiate overrides, and `EcsWorld` prefab specs
- `typed_schedule_inference.ts` — `Schedule.add` context typing and `CommandBuffer` payload / pending-handle typing

They use `@ts-expect-error` to assert that invalid access is rejected at compile time.

`deno task smoke:consumers` runs separately from the Deno unit suite. It builds
the current source as a local npm tarball, installs it in separate clean npm
and Bun projects, checks public declarations and gameplay, then exercises the
standalone browser bundle in real Chromium. Its consumer script is
`consumer-fixture.mjs`, plain JavaScript that is linted but not run by `deno test`. Node/npm/Bun and an external
Playwright installation with Chromium are required; set
`MISKI_PLAYWRIGHT_MODULE` to Playwright's `index.mjs` path. All consumer files
are temporary and no registry publish occurs.
