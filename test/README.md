# Tests

Runtime tests live in `*.test.ts` files and run via `deno test` (see `deno.json` `test.include`).

## Domain map

| File | Covers |
| --- | --- |
| `ecs_gameplay_contracts.test.ts` | Happy-path gameplay: capacity, systems, queries, batch transitions, multi-world |
| `ecs_validation_contracts.test.ts` | Spec rejection and registry consistency |
| `system_call_forwarding.test.ts` | System call args: exact arity, rest params, defaults, return values, `argCount` fixed-arity forwarding and validation |
| `game_oriented_api_evidence.test.ts` | `include`, bundles/spawn preflight, changed marking |
| `world_api_conveniences.test.ts` | Soft reads, upserts, `createOrThrow`, iterable `queryList` |
| `world_regressions.test.ts` | Edge cases: maxEntities, entered/exited, cache freshness, batch atomicity |
| `learnings.test.ts` | Newer APIs: frame, revision, createEcsWorld, schema hash, checkpoint, rollback |
| `module_graph.test.ts` | Forbidden import coupling edges |
| `component_integrity.test.ts` | Guarded identities, numeric writes, reserved schema fields, capped defaults |
| `component_field_types.test.ts` | `field.*` bool / enum / entity / string / object fields: layout, defaults, validation, proxy, rollback, checkpoints, copy |
| `world_integrity.test.ts` | Atomic spawn/checkpoints, historical exits, rollback identities, slot bounds |
| `world_lifecycle_integrity.test.ts` | Async readiness, teardown concurrency, failure cleanup, `await using` disposal during destroy, in-flight init and failed init |
| `rollback_scope.test.ts` | `WorldRollbackScope` with `using`: restore when left without `commit()` (also on throw), commit, explicit restore, disposal on destroyed and errored worlds |
| `float16_column.test.ts` | `Float16Array` columns: writes, canonicalization, saves, documents, rollback |
| `rollback_checkpoint_integrity.test.ts` | One rollback scope, closed and per-world rollback scopes, foreign checkpoints, >32-component round-trips |
| `component_storage_integrity.test.ts` | Capped (dense-row) storage under stray non-owner writes, ownership acquisition, cap clamping, column constructors |
| `component_rollback_memory.test.ts` | Capped owners and dense rows through rollback and removal, sparse changed window, `getActive` scratch growth, 16-bit-capacity rollback |
| `component_tracking_regressions.test.ts` | Changed marking for newly owned components, `applyCheckpoint` during `getOwners` iteration, failed bundle spawns stripping committed components |
| `component_write_regressions.test.ts` | `set` / `setAt` leave the shared proxy cursor alone across every field kind, changed marking and revision per real write, `[Ctor, initial]` tuples rejected with `SpecError` |
| `entity_slot_reuse.test.ts` | Next-fit slot reissue, churn rotation, stale handles not reissued, generation wrap limit |
| `query_archetype_perf.test.ts` | Query result order and generations through moves, batches and rollback; refills only for related changes, by copying handles |
| `query_iteration.test.ts` | Per-call `query()` / `getActive()` iterators: nested loops (same and different queries, different bounds), pool reuse, destroy or remove during `query()` / `queryList()` / `getActive()` iteration |
| `query_schema_integrity.test.ts` | System arity forwarding, query alias keys and immutable metadata, retained result buffers, schema hashing and bootstrap validation |
| `query_transition_integrity.test.ts` | Atomic bundle spawn, entered/exited relative to the refresh window (also after rollback), nested transition iteration |
| `rollback_neutrality.test.ts` | Committing a rollback scope leaves allocation and iteration order untouched |
| `review_regressions.test.ts` | Storage and rollback cost scale with population, rollback keeps query order and allocation cursor, `getActive` bounds, `Query.compose` include roles |
| `randomized_model.test.ts` | Seeded random operations checked against a plain model, with a twin control world proving rollback leaves no trace |
| `spawn_scratch_reuse.test.ts` | `EcsWorld.spawn` scratch reuse: no leaked components or data, undefined-skip and tag validation, re-entrant spawns from getters |
| `system_lifecycle_regressions.test.ts` | Init and destroy hooks awaiting `systems.destroy` reject instead of deadlocking; teardown rejects instead of throwing |
| `prefab.test.ts` | Prefab definition, `extends` flattening, instantiate / instantiateMany differential against `createWith`, atomicity, capped components, rollback, `EcsWorld` helpers |
| `prefab_field_types.test.ts` | Prefabs with `field.*` columns: logical defaults, null-only entity refs, per-instance `create()` / `clone`, rejection of shared objects, throwing hooks |
| `relations_cross.test.ts` | Relations with prefabs and field types: relation entries rejected in prefabs and overrides, numeric-only pair data, rollback and checkpoints restoring side columns and pairs together |
| `feature_review.test.ts` | Post-merge review regressions: save field-value and masked-generation checks, nested `instantiateMany` lists, relation checkpoint order and undefined pair data, command buffers rejecting relations when queued |
| `scheduler_cross.test.ts` | Command buffers with field types, relations and prefabs: every field kind at flush, dead entity refs written as null, drain-then-rethrow, relation tags rejected when queued |
| `serialization_cross.test.ts` | World saves with field types: bool/enum/entity round-trips, field tags in layouts, label-order and kind mismatches, documents, object fields without hooks rejected on every entry point |
| `relations.test.ts` | Relations: pairs, order, data, exclusive/acyclic, cleanup and cascades, traversal, guards, checkpoints, rollback, `createEcsWorld` |
| `relations_model.test.ts` | Seeded random relation operations (including cascades and rollback) checked against a plain-array model |
| `schedule.test.ts` | `Schedule`: phase and constraint order, cycles, fixed timestep, context, run conditions, refresh and error semantics, per-phase command flushes, clock save/restore with rollback |
| `command_buffer.test.ts` | `CommandBuffer`: deferred spawn/destroy/add/set/remove, pending handles, partial payloads, inactive targets, drain-on-error flushes, wide and non-numeric fields, growth |
| `world_save.test.ts` | Whole-world saves: twin-world load differential, `saveWorld` into a reused buffer, header/layout, mismatch and migrate, corruption fuzz, JSON round-trip, no aliasing |
| `world_save_fields.test.ts` | World saves of string and object fields: round-trips into fresh worlds, encode/decode hook rules, null objects, missing hooks, throwing decode leaves the world untouched, unencodable strings, documents, corruption fuzz, continued behavior |
| `world_save_relations.test.ts` | World saves of relations: twin-world differential (getTargets / getSources / traverse order, rows, changed, continued behavior, byte-identical re-saves), load over a busy world, layout entries and option mismatches, JSON shape and round-trip, document rejections, binary target checks, relation-section corruption fuzz, `saveWorld` into a reused buffer and migrate |
| `release_integrity.test.ts` | Runtime, `deno.json`, README install snippet, and CHANGELOG version consistency (reads `README.md` and `CHANGELOG.md`; `deno task test` grants `--allow-read` for just those files) |

## Shared fixtures

`fixtures.ts` provides common ECS setup helpers used across test files:

- `vec2Component(name?, options?)` — `{ x, y }` schema component
- `tagComponent(name, options?)` — tag (null-schema) component
- `createEntity(world)` — create an entity and assert success
- `createTestWorld(components, capacity?)` — construct, init, and return a world

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
standalone browser bundle in real Chromium. Node/npm/Bun and an external
Playwright installation with Chromium are required; set
`MISKI_PLAYWRIGHT_MODULE` to Playwright's `index.mjs` path. All consumer files
are temporary and no registry publish occurs.
