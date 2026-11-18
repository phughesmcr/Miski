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
| `world_lifecycle_integrity.test.ts` | Async readiness, teardown concurrency, failure cleanup |
| `rollback_checkpoint_integrity.test.ts` | One rollback scope, consumed/foreign rollback points, foreign checkpoints, >32-component round-trips |
| `release_integrity.test.ts` | Runtime, `deno.json`, README install snippet, and CHANGELOG version consistency (reads `README.md` and `CHANGELOG.md`; `deno task test` grants `--allow-read` for just those files) |

## Shared fixtures

`fixtures.ts` provides common ECS setup helpers used across test files:

- `vec2Component(name?, options?)` — `{ x, y }` schema component
- `tagComponent(name, options?)` — tag (null-schema) component
- `createEntity(world)` — create an entity and assert success
- `createTestWorld(components, capacity?)` — construct, init, and return a world

Assertion helpers live in `helpers.ts`.

## Compile-only checks

These files are type-checked by `deno task check` but are **not** executed by `deno test`:

- `typed_system_inference.ts` — `new System` / `new Query` callback, query-map and `argCount` inference
- `query_constructor_inference.ts` — typed `Query({ all: { … } })` constructor inference
- `typed_ecs_world_inference.ts` — `createEcsWorld` / schema-world spawn and storage inference
- `entity_api_inference.ts` — slot bounds reject packed entity handles
- `field_type_inference.ts` — `field.*` value, payload, proxy and partition types

They use `@ts-expect-error` to assert that invalid access is rejected at compile time.

`deno task smoke:consumers` runs separately from the Deno unit suite. It builds
the current source as a local npm tarball, installs it in separate clean npm
and Bun projects, checks public declarations and gameplay, then exercises the
standalone browser bundle in real Chromium. Node/npm/Bun and an external
Playwright installation with Chromium are required; set
`MISKI_PLAYWRIGHT_MODULE` to Playwright's `index.mjs` path. All consumer files
are temporary and no registry publish occurs.
