# Tests

Runtime tests live in `*.test.ts` files and run via `deno test` (see `deno.json` `test.include`).

## Domain map

| File | Covers |
| --- | --- |
| `ecs_gameplay_contracts.test.ts` | Happy-path gameplay: capacity, systems, queries, batch transitions, multi-world |
| `ecs_validation_contracts.test.ts` | Spec rejection and registry consistency |
| `game_oriented_api_evidence.test.ts` | `include`, bundles/spawn preflight, changed marking |
| `world_api_conveniences.test.ts` | Soft reads, upserts, `createOrThrow`, iterable `queryList` |
| `world_regressions.test.ts` | Edge cases: maxEntities, entered/exited, cache freshness, batch atomicity |
| `learnings.test.ts` | Newer APIs: frame, revision, createEcsWorld, schema hash, checkpoint, rollback |
| `module_graph.test.ts` | Forbidden import coupling edges |

## Shared fixtures

`fixtures.ts` provides common ECS setup helpers used across test files:

- `vec2Component(name?, options?)` — `{ x, y }` schema component
- `tagComponent(name, options?)` — tag (null-schema) component
- `createEntity(world)` — create an entity and assert success
- `createTestWorld(components, capacity?)` — construct, init, and return a world

Assertion helpers live in `helpers.ts`.

## Compile-only checks

These files are type-checked by `deno task check` but are **not** executed by `deno test`:

- `typed_system_inference.ts` — `new System` / `new Query` callback and query-map inference
- `query_constructor_inference.ts` — typed `Query({ all: { … } })` constructor inference
- `typed_ecs_world_inference.ts` — `createEcsWorld` / schema-world spawn and storage inference

They use `@ts-expect-error` to assert that invalid access is rejected at compile time.
