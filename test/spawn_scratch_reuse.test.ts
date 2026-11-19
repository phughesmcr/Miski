/// <reference lib="deno.ns" />

import { CapacityError, ComponentDataError, createEcsWorld } from "../mod.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "./helpers.ts";

Deno.test("EcsWorld.spawn reuses scratch without leaking components or data between calls", async () => {
  const ecs = createEcsWorld({
    capacity: 16,
    components: { Position: { x: Float32Array, y: Float32Array }, Velocity: { x: Float32Array } },
    tags: { Player: true },
  });
  await ecs.init();

  const first = ecs.spawnOrThrow({ Position: { x: 1, y: 2 }, Velocity: { x: 3 }, Player: true });
  const second = ecs.spawnOrThrow({ Position: { x: 4 } });
  assert(ecs.world.components.entityHas("Velocity", first), "first entity keeps Velocity");
  assert(!ecs.world.components.entityHas("Velocity", second), "second entity gets no stale Velocity");
  assert(!ecs.world.components.entityHas("Player", second), "second entity gets no stale tag");
  assertEquals(
    ecs.world.components.getEntityDataOrThrow("Position", second),
    { x: 4, y: 0 },
    "second spawn uses its own data",
  );

  // A failed spawn must not poison the next one.
  assertThrows(() => ecs.spawn({ Position: { x: 1 }, Unknown: true } as never), Error, "Unknown component");
  const third = ecs.spawnOrThrow({ Velocity: { x: 9 } });
  assert(!ecs.world.components.entityHas("Position", third), "no stale Position after a failed spawn");
  assertEquals(ecs.world.components.getEntityDataOrThrow("Velocity", third), { x: 9 }, "third spawn uses its own data");
});

Deno.test("EcsWorld.spawn keeps undefined-skip and tag validation semantics across reuse", async () => {
  const ecs = createEcsWorld({
    capacity: 16,
    components: { Position: { x: Float32Array } },
    tags: { Player: true },
  });
  await ecs.init();

  assertThrows(
    () => ecs.spawn({ Position: { x: 1 }, Player: false as never }),
    ComponentDataError,
    "must be spawned with true",
  );
  const clean = ecs.spawnOrThrow({ Position: undefined, Player: undefined });
  assert(!ecs.world.components.entityHas("Position", clean), "undefined data skips the component after a throw");
  assert(!ecs.world.components.entityHas("Player", clean), "undefined tag skips the tag after a throw");

  const inherited = Object.create({ Player: true }) as { Position?: { x: number } };
  inherited.Position = { x: 2 };
  const own = ecs.spawnOrThrow(inherited as never);
  assert(!ecs.world.components.entityHas("Player", own), "inherited spec keys are ignored");
  assertEquals(ecs.world.components.getEntityDataOrThrow("Position", own), { x: 2 }, "own spec keys are used");
});

Deno.test("EcsWorld.spawn called from a spec getter does not clobber the outer spawn", async () => {
  const ecs = createEcsWorld({
    capacity: 16,
    components: { A: { x: Float32Array }, B: { x: Float32Array } },
  });
  await ecs.init();

  let inner: ReturnType<typeof ecs.spawn> | undefined;
  const spec = { A: { x: 5 } } as Record<string, unknown>;
  Object.defineProperty(spec, "B", {
    enumerable: true,
    get() {
      inner = ecs.spawn({ A: { x: 9 } });
      return { x: 7 };
    },
  });
  const outer = ecs.spawnOrThrow(spec as never);
  assertEquals(ecs.world.components.getEntityDataOrThrow("A", outer), { x: 5 }, "outer A keeps its own data");
  assertEquals(ecs.world.components.getEntityDataOrThrow("B", outer), { x: 7 }, "outer B is applied");
  assert(inner !== undefined, "inner spawn ran");
  assertEquals(ecs.world.components.getEntityDataOrThrow("A", inner!), { x: 9 }, "inner A keeps its own data");
  assert(!ecs.world.components.entityHas("B", inner!), "inner entity has no outer components");
});

Deno.test("EcsWorld plain spawn/instantiate return undefined at capacity; OrThrow variants throw", async () => {
  const ecs = createEcsWorld({ capacity: 8, components: { Position: { x: Float32Array } }, tags: { Player: true } });
  await ecs.init();
  const orc = ecs.prefab({ Position: { x: 1 } });
  assertStrictEquals(ecs.instantiateMany(orc, 9), undefined, "bulk instantiate that does not fit");
  assertThrows(() => ecs.instantiateManyOrThrow(orc, 9), CapacityError, "8 of 8 slots free");
  assertStrictEquals(ecs.world.entities.getActiveCount(), 0, "a rejected bulk call creates nothing");
  const first = ecs.spawn({ Position: { x: 2 }, Player: true });
  assertStrictEquals(first, 0, "handle 0 is a valid entity");
  ecs.instantiateOrThrow(orc);
  ecs.spawnOrThrow({ Player: true });
  assertStrictEquals(ecs.instantiateManyOrThrow(orc, 5).count, 5, "fill the world");

  assertStrictEquals(ecs.spawn({ Position: { x: 9 } }), undefined, "spawn at capacity");
  assertStrictEquals(ecs.instantiate(orc, { Player: true }), undefined, "instantiate at capacity");
  assertStrictEquals(ecs.instantiateMany(orc, 1), undefined, "instantiateMany at capacity");
  assertThrows(() => ecs.spawnOrThrow({ Position: { x: 9 } }), CapacityError, "capacity");
  assertThrows(() => ecs.instantiateOrThrow(orc), CapacityError, "capacity");
  assertThrows(() => ecs.spawn({ Player: false as never }), ComponentDataError, "must be spawned with true");
  assertStrictEquals(ecs.world.entities.getActiveCount(), 8, "rejected calls create nothing");

  ecs.world.entities.destroy(first!);
  const next = ecs.spawnOrThrow({ Position: { x: 5 } });
  assertEquals(ecs.world.components.getEntityData("Position", next), { x: 5 }, "scratch is clean after failures");
  assert(!ecs.world.components.entityHas("Player", next), "no stale tag from a rejected spawn");
});
