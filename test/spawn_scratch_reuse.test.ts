/// <reference lib="deno.ns" />

import { createEcsWorld } from "../mod.ts";
import { assert, assertEquals, assertThrows } from "./helpers.ts";

Deno.test("EcsWorld.spawn reuses scratch without leaking components or data between calls", async () => {
  const ecs = createEcsWorld({
    capacity: 16,
    components: { Position: { x: Float32Array, y: Float32Array }, Velocity: { x: Float32Array } },
    tags: { Player: true },
  });
  await ecs.init();

  const first = ecs.spawn({ Position: { x: 1, y: 2 }, Velocity: { x: 3 }, Player: true });
  const second = ecs.spawn({ Position: { x: 4 } });
  assert(ecs.world.components.entityHas("Velocity", first), "first entity keeps Velocity");
  assert(!ecs.world.components.entityHas("Velocity", second), "second entity gets no stale Velocity");
  assert(!ecs.world.components.entityHas("Player", second), "second entity gets no stale tag");
  assertEquals(
    ecs.world.components.getEntityData("Position", second),
    { x: 4, y: 0 },
    "second spawn uses its own data",
  );

  // A failed spawn must not poison the next one.
  assertThrows(() => ecs.spawn({ Position: { x: 1 }, Unknown: true } as never), Error, "Unknown component");
  const third = ecs.spawn({ Velocity: { x: 9 } });
  assert(!ecs.world.components.entityHas("Position", third), "no stale Position after a failed spawn");
  assertEquals(ecs.world.components.getEntityData("Velocity", third), { x: 9 }, "third spawn uses its own data");
});

Deno.test("EcsWorld.spawn keeps undefined-skip and tag validation semantics across reuse", async () => {
  const ecs = createEcsWorld({
    capacity: 16,
    components: { Position: { x: Float32Array } },
    tags: { Player: true },
  });
  await ecs.init();

  assertThrows(() => ecs.spawn({ Position: { x: 1 }, Player: false as never }), TypeError, "must be spawned with true");
  const clean = ecs.spawn({ Position: undefined, Player: undefined });
  assert(!ecs.world.components.entityHas("Position", clean), "undefined data skips the component after a throw");
  assert(!ecs.world.components.entityHas("Player", clean), "undefined tag skips the tag after a throw");

  const inherited = Object.create({ Player: true }) as { Position?: { x: number } };
  inherited.Position = { x: 2 };
  const own = ecs.spawn(inherited as never);
  assert(!ecs.world.components.entityHas("Player", own), "inherited spec keys are ignored");
  assertEquals(ecs.world.components.getEntityData("Position", own), { x: 2 }, "own spec keys are used");
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
  const outer = ecs.spawn(spec as never);
  assertEquals(ecs.world.components.getEntityData("A", outer), { x: 5 }, "outer A keeps its own data");
  assertEquals(ecs.world.components.getEntityData("B", outer), { x: 7 }, "outer B is applied");
  assert(inner !== undefined, "inner spawn ran");
  assertEquals(ecs.world.components.getEntityData("A", inner!), { x: 9 }, "inner A keeps its own data");
  assert(!ecs.world.components.entityHas("B", inner!), "inner entity has no outer components");
});
