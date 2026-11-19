/// <reference lib="deno.ns" />

import {
  CapacityError,
  captureWorldRollbackPoint,
  type Entity,
  Query,
  restoreWorldRollbackPoint,
  SpecError,
  type World,
} from "../mod.ts";
import { Archetype } from "../src/archetype/archetype.ts";
import { createEntity, createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertThrows, ids } from "./helpers.ts";

function sorted(values: Iterable<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

Deno.test("bundle spawn is atomic and never reports a false exit from the root archetype", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const missingPosition = new Query({ none: [position] });
  const hasPosition = new Query({ all: [position] });
  world.entities.queryList(missingPosition);
  world.refresh();

  const soft = world.entities.createWith([[position, { x: 1 }]])!;
  assertEquals(ids(world.entities.queryExited(missingPosition)), [], "createWith must not exit root");
  assertEquals(ids(world.entities.queryEntered(missingPosition)), [], "createWith must not enter root");
  assertEquals(ids(world.entities.queryEntered(hasPosition)), [soft], "createWith enters its final archetype");
  assert(!world.archetypes.isEntityInRoot(soft), "Bundle spawn must land outside root");

  const strict = world.entities.createWithOrThrow([[position, { x: 2 }]]);
  assertEquals(ids(world.entities.queryExited(missingPosition)), [], "createWithOrThrow must not exit root");
  assertEquals(sorted(world.entities.queryEntered(hasPosition)), sorted([soft, strict]), "Both spawns entered");

  const empty = world.entities.createWithOrThrow([]);
  assertEquals(ids(world.entities.queryEntered(missingPosition)), [empty], "Empty bundle spawns into root");
  assertEquals(ids(world.entities.queryExited(missingPosition)), [], "Empty bundle spawn is not an exit");
  await world.destroy();
});

Deno.test("queryEntered ignores entities that never left the query", async () => {
  const position = vec2Component();
  const tag = tagComponent("tag");
  const world = await createTestWorld([position, tag]);
  const query = new Query({ all: [position] });
  const entity = createEntity(world);
  world.components.addToEntity(position, entity);
  world.refresh();

  world.components.addToEntity(tag, entity);
  assertEquals(ids(world.entities.queryEntered(query)), [], "Unrelated tag must not re-enter the query");
  assertEquals(ids(world.entities.queryExited(query)), [], "Unrelated tag must not exit the query");

  world.refresh();
  world.components.removeFromEntity(position, entity);
  world.components.addToEntity(position, entity);
  assertEquals(ids(world.entities.queryEntered(query)), [], "Leave and return within a window is not an entry");
  assertEquals(ids(world.entities.queryExited(query)), [], "Leave and return within a window is not an exit");
  await world.destroy();
});

Deno.test("query transitions are relative to the start of the refresh window", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity], 16);
  const missingVelocity = new Query({ all: [position], none: [velocity] });
  const movers = new Query({ all: [position, velocity] });
  const anyQuery = new Query({ any: [position, velocity] });

  const entity = createEntity(world);
  world.components.addToEntity(position, entity);
  world.refresh();

  world.components.addToEntity(velocity, entity);
  assertEquals(ids(world.entities.queryEntered(movers)), [entity], "Adding velocity enters movers");
  assertEquals(ids(world.entities.queryExited(missingVelocity)), [entity], "Adding velocity exits no-velocity");
  assertEquals(ids(world.entities.queryEntered(anyQuery)), [], "any query was already matching");
  assertEquals(ids(world.entities.queryExited(anyQuery)), [], "any query keeps matching");

  // Stay within `any` through several archetypes: still no transition.
  world.refresh();
  world.components.removeFromEntity(position, entity);
  assertEquals(ids(world.entities.queryEntered(anyQuery)), [], "any entry must not appear on partial change");
  assertEquals(ids(world.entities.queryExited(anyQuery)), [], "any exit must not appear on partial change");

  // Spawned and destroyed inside one window: never observed at a window boundary.
  world.refresh();
  const transient = createEntity(world);
  world.components.addToEntity(position, transient);
  world.entities.destroy(transient);
  assertEquals(ids(world.entities.queryEntered(new Query({ all: [position] }))), [], "Transient never entered");
  assertEquals(ids(world.entities.queryExited(new Query({ all: [position] }))), [], "Transient never exited");

  // A recycled slot reports the departed handle as exited and the replacement as entered.
  world.components.addToEntity(position, entity);
  world.refresh();
  world.entities.destroy(entity);
  const replacement = createEntity(world);
  world.components.addToEntity(velocity, replacement);
  assert(replacement !== entity, "Recycled slot carries a new generation");
  assertEquals(ids(world.entities.queryExited(movers)), [entity], "Departed handle was a mover at window start");
  assertEquals(ids(world.entities.queryEntered(movers)), [], "Replacement is not a mover");
  assertEquals(ids(world.entities.queryExited(new Query({ all: [position] }))), [entity], "Departed handle exits");
  assertEquals(ids(world.entities.queryEntered(new Query({ all: [velocity] }))), [replacement], "Replacement enters");
  await world.destroy();
});

Deno.test("rollback restores window origins so later transitions stay window-relative", async () => {
  const position = vec2Component();
  const tag = tagComponent("tag");
  const world = await createTestWorld([position, tag]);
  const query = new Query({ all: [position] });
  const member = createEntity(world);
  world.components.addToEntity(position, member);
  world.refresh();
  world.components.addToEntity(tag, member);

  const point = captureWorldRollbackPoint(world);
  world.components.removeFromEntity(position, member);
  const speculative = createEntity(world);
  world.components.addToEntity(position, speculative);
  restoreWorldRollbackPoint(world, point);
  assertEquals(ids(world.entities.queryEntered(query)), [], "Speculative entry must be discarded");
  assertEquals(ids(world.entities.queryExited(query)), [], "Speculative exit must be discarded");

  world.components.removeFromEntity(position, member);
  assertEquals(ids(world.entities.queryExited(query)), [member], "Window origin survives rollback");
  await world.destroy();
});

Deno.test("nested queryExited iteration yields each exited entity once", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const tag = tagComponent("tag");
  const world = await createTestWorld([position, velocity, tag], 16);
  const outer = new Query({ any: [position, velocity, tag] });
  const inner = new Query({ any: [position, velocity] });
  const entities: Entity[] = [];
  for (let i = 0; i < 3; i++) {
    const entity = createEntity(world);
    world.components.addToEntity(position, entity);
    world.components.addToEntity(velocity, entity);
    world.components.addToEntity(tag, entity);
    entities.push(entity);
  }
  world.refresh();

  // Each entity passes through several archetypes that match both queries before leaving.
  for (const entity of entities) {
    world.components.removeFromEntity(tag, entity);
    world.components.removeFromEntity(velocity, entity);
    world.components.removeFromEntity(position, entity);
  }

  const seen: number[] = [];
  let innerCount = 0;
  for (const entity of world.entities.queryExited(outer)) {
    seen.push(entity);
    for (const _other of world.entities.queryExited(inner)) innerCount++;
  }
  assertEquals(sorted(seen), sorted(entities), "Outer iteration must yield each exit exactly once");
  assertEquals(innerCount, entities.length * entities.length, "Inner iteration must stay complete");
  await world.destroy();
});

Deno.test("nested queryEntered and query iteration stay independent", async () => {
  const position = vec2Component();
  const tag = tagComponent("tag");
  const world = await createTestWorld([position, tag], 16);
  const query = new Query({ all: [position] });
  const entities: Entity[] = [];
  for (let i = 0; i < 4; i++) {
    const entity = createEntity(world);
    world.components.addToEntity(position, entity);
    if (i % 2 === 0) world.components.addToEntity(tag, entity);
    entities.push(entity);
  }
  const seenEntered: number[] = [];
  let enteredPairs = 0;
  for (const entity of world.entities.queryEntered(query)) {
    seenEntered.push(entity);
    for (const _other of world.entities.queryEntered(query)) enteredPairs++;
  }
  assertEquals(sorted(seenEntered), sorted(entities), "Entered yields each entity once");
  assertEquals(enteredPairs, 16, "Nested entered iteration is complete");

  const seenLive: number[] = [];
  let livePairs = 0;
  for (const entity of world.entities.query(query)) {
    seenLive.push(entity);
    for (const _other of world.entities.query(query)) livePairs++;
  }
  assertEquals(sorted(seenLive), sorted(entities), "Live iteration yields each entity once");
  assertEquals(livePairs, 16, "Nested query iteration is complete");
  await world.destroy();
});

Deno.test("Query.compose preserves AND semantics between input any groups", async () => {
  const a = tagComponent("a");
  const b = tagComponent("b");
  const c = tagComponent("c");
  const d = tagComponent("d");
  const world = await createTestWorld([a, b, c, d], 16);
  const withAnyAndAll = Query.compose([new Query({ any: [a, b] }), new Query({ all: [c] })]);

  const onlyA = createEntity(world);
  world.components.addToEntity(a, onlyA);
  const aAndC = createEntity(world);
  world.components.addToEntity(a, aAndC);
  world.components.addToEntity(c, aAndC);
  const onlyC = createEntity(world);
  world.components.addToEntity(c, onlyC);
  const bAndC = createEntity(world);
  world.components.addToEntity(b, bAndC);
  world.components.addToEntity(c, bAndC);
  assertEquals(
    sorted(world.entities.query(withAnyAndAll)),
    sorted([aAndC, bAndC]),
    "(a|b) AND c must require c and one of a/b",
  );

  // A single any group passes through unchanged, including alongside another input's none/include.
  const single = Query.compose([new Query({ any: [a, b] }), new Query({ none: [d] })]);
  assertEquals(single.any.length, 2, "Single any group is preserved");

  assertThrows(
    () => Query.compose([new Query({ any: [a, b] }), new Query({ any: [c, d] })]),
    SpecError,
    "at most one",
  );
  await world.destroy();
});

Deno.test("full-world bundle creation reports payload errors before capacity errors", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const created = Array.from({ length: world.entities.capacity }, () => world.entities.createOrThrow());

  assertThrows(() => world.entities.createWith(42 as never), TypeError, "Bundle");
  assertThrows(
    () => world.entities.createWith([[position, { x: Number.MAX_VALUE }]]),
    TypeError,
    "outside its storage range",
  );
  assertThrows(
    () => world.entities.createWithOrThrow([[position, { nope: 1 } as never]]),
    Error,
    "nope",
  );
  assertEquals(world.entities.createWith([[position, { x: 1 }]]), undefined, "Valid bundle on full world is undefined");
  assertThrows(() => world.entities.createWithOrThrow([[position, { x: 1 }]]), CapacityError, "capacity");
  assertEquals(world.entities.getActiveSnapshot(), created, "Failures preserve active handles");

  // Scratch state must stay clean after a capacity failure.
  world.entities.destroy(created[0]!);
  const recovered = world.entities.createWithOrThrow([[position, { x: 3 }]]);
  assert(world.entities.isActive(recovered), "Spawn succeeds once capacity returns");
  await world.destroy();
});

Deno.test("default archetype bitfield is sized by the highest component id", () => {
  const instance = { id: 9, type: { name: "late" } } as never;
  const archetype = new Archetype(4, [instance]);
  assert(archetype.bitfield.get(9), "Component id beyond the component count must be addressable");
});

type MembershipModel = {
  start: Map<number, Set<string>>;
};

Deno.test("incremental query membership matches a brute-force model across random transitions", async () => {
  const names = ["a", "b", "c", "d", "e"];
  const components = names.map((name) => tagComponent(name));
  const world = await createTestWorld(components, 24);
  const queries = [
    new Query({ all: [components[0]!] }),
    new Query({ all: [components[1]!], none: [components[2]!] }),
    new Query({ any: [components[2]!, components[3]!] }),
    new Query({ none: [components[0]!] }),
    new Query({ all: [components[0]!, components[4]!] }),
  ];
  const registeredLate = new Query({ all: [components[3]!], none: [components[1]!] });

  let seed = 0x2f6e2b1;
  const random = (limit: number): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };

  const live = new Set<Entity>();
  const membership = (world: World, entity: Entity): Set<string> => {
    const result = new Set<string>();
    for (let i = 0; i < components.length; i++) {
      if (world.components.entityHas(components[i]!, entity)) result.add(names[i]!);
    }
    return result;
  };
  const matches = (query: Query, owned: Set<string>): boolean => {
    for (const component of query.all) if (!owned.has(component.name)) return false;
    for (const component of query.none) if (owned.has(component.name)) return false;
    if (query.any.length > 0 && !query.any.some((component) => owned.has(component.name))) return false;
    return true;
  };

  const model: MembershipModel = { start: new Map() };
  const snapshotStart = (): void => {
    model.start.clear();
    for (const entity of live) model.start.set(entity, membership(world, entity));
  };
  const verify = (activeQueries: Query[]): void => {
    for (const query of activeQueries) {
      const expectedLive: number[] = [];
      const expectedEntered: number[] = [];
      for (const entity of live) {
        const owned = membership(world, entity);
        const now = matches(query, owned);
        if (now) expectedLive.push(entity);
        const before = model.start.get(entity);
        if (now && (before === undefined || !matches(query, before))) expectedEntered.push(entity);
      }
      const expectedExited: number[] = [];
      for (const [handle, before] of model.start) {
        if (!matches(query, before)) continue;
        if (!live.has(handle as Entity) || !matches(query, membership(world, handle as Entity))) {
          expectedExited.push(handle);
        }
      }
      assertEquals(sorted(world.entities.query(query)), sorted(expectedLive), "Live membership diverged");
      assertEquals(sorted(world.entities.queryEntered(query)), sorted(expectedEntered), "Entered diverged");
      assertEquals(sorted(world.entities.queryExited(query)), sorted(expectedExited), "Exited diverged");
    }
  };

  const active = [...queries];
  verify(active);
  for (let step = 0; step < 400; step++) {
    const op = random(10);
    if (op === 0 && live.size < 24) {
      const entity = createEntity(world);
      live.add(entity);
    } else if (op === 1 && live.size > 0) {
      const entity = [...live][random(live.size)]!;
      world.entities.destroy(entity);
      live.delete(entity);
    } else if (op === 2) {
      world.refresh();
      snapshotStart();
    } else if (op === 3 && active.length === queries.length) {
      active.push(registeredLate);
    } else if (live.size > 0) {
      const entity = [...live][random(live.size)]!;
      const component = components[random(components.length)]!;
      if (world.components.entityHas(component, entity)) world.components.removeFromEntity(component, entity);
      else world.components.addToEntity(component, entity);
    }
    if (step % 3 === 0) verify(active);
  }
  verify(active);
  await world.destroy();
});
