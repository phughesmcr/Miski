# Tests

Runtime tests live in `*.test.ts` files and run via `deno test` (see `deno.json` `test.include`).

## Shared fixtures

`fixtures.ts` provides common ECS setup helpers used across test files:

- `vec2Component(name?, options?)` — `{ x, y }` schema component
- `tagComponent(name, options?)` — tag (null-schema) component
- `createEntity(world)` — create an entity and assert success
- `createTestWorld(components, capacity?)` — construct, init, and return a world

Assertion helpers live in `helpers.ts`.

## Compile-only checks

These files are type-checked by `deno task check` but are **not** executed by `deno test`:

- `typed_system_inference.ts` — `defineSystem` callback and query-map inference
- `query_constructor_inference.ts` — typed `Query({ all: { … } })` constructor inference

They use `@ts-expect-error` to assert that invalid access is rejected at compile time.
