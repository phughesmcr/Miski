/// <reference lib="deno.ns" />

import {
  CapacityError,
  Component,
  ComponentDataError,
  ComponentOwnershipError,
  entityIndex,
  EntityNotFoundError,
  NotRegisteredError,
  Query,
  SpecError,
  System,
  World,
  WorldStateError,
} from "../mod.ts";
import type { ComponentBundleEntryInput } from "../mod.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows, ids, listIds } from "./helpers.ts";
import { createEntity, createTestWorld } from "./fixtures.ts";

type GridPosValue = { x: number; y: number };
type GridPosStorage = { x: Int16ArrayConstructor; y: Int16ArrayConstructor };
type FacingValue = { dir: 0 | 1 | 2 | 3 };
type FacingStorage = { dir: Uint8ArrayConstructor };
type HealthValue = { hp: number };
type HealthStorage = { hp: Uint16ArrayConstructor };

function gameComponents(): {
  GridPos: Component<GridPosValue, GridPosStorage>;
  Facing: Component<FacingValue, FacingStorage>;
  Drawable: Component<null>;
  Health: Component<HealthValue, HealthStorage>;
  Door: Component<null>;
} {
  return {
    GridPos: new Component<GridPosValue, GridPosStorage>({
      name: "gridPos",
      schema: { x: Int16Array, y: Int16Array },
    }),
    Facing: new Component<FacingValue, FacingStorage>({
      name: "facing",
      schema: { dir: Uint8Array },
    }),
    Drawable: new Component<null>({ name: "drawable" }),
    Health: new Component<HealthValue, HealthStorage>({
      name: "health",
      schema: { hp: Uint16Array },
    }),
    Door: new Component<null>({ name: "door" }),
  };
}

Deno.test("include exposes optional component instances without filtering render query membership", async () => {
  const { Door, Drawable, Facing, GridPos, Health } = gameComponents();
  const world = await createTestWorld([GridPos, Facing, Drawable, Health, Door], 16);
  const withFacing = createEntity(world);
  const noFacing = createEntity(world);
  const withHealth = createEntity(world);
  const hidden = createEntity(world);

  world.components.addBundle(withFacing, [
    [GridPos, { x: 1, y: 2 }],
    [Facing, { dir: 2 }],
    [Drawable],
  ]);
  world.components.addBundle(noFacing, [
    [GridPos, { x: 3, y: 4 }],
    [Drawable],
  ]);
  world.components.addBundle(withHealth, [
    [GridPos, { x: 5, y: 6 }],
    [Drawable],
    [Health, { hp: 9 }],
  ]);
  world.components.addBundle(hidden, [
    [GridPos, { x: 7, y: 8 }],
    [Facing, { dir: 1 }],
  ]);

  const renderQuery = new Query({
    all: { pos: GridPos, drawable: Drawable },
    include: { facing: Facing, health: Health, door: Door },
  });
  const components = world.components.query(renderQuery);

  assertEquals(
    ids(world.entities.query(renderQuery)),
    [withFacing, noFacing, withHealth],
    "Expected include components not to filter render query membership",
  );
  assert(components["facing"]?.has(withFacing) === true, "Expected included Facing to report owners");
  assert(components["facing"]?.has(noFacing) === false, "Expected included Facing to report non-owners");
  assert(components["health"]?.has(withHealth) === true, "Expected included Health to report owners");
  assert(components["door"]?.has(withFacing) === false, "Expected included Door tag to report non-owners");

  const rendered: string[] = [];
  const renderSystem = new System({
    name: "renderEvidence",
    query: renderQuery,
    callback: (renderComponents, entities): void => {
      const posX = renderComponents.pos.partitions.x;
      const posY = renderComponents.pos.partitions.y;
      const facing = renderComponents.facing.partitions.dir;
      for (let i = 0; i < entities.count; i++) {
        const entity = entities.entities[i]!;
        const slot = entities.indices[i]!;
        const dir = renderComponents.facing.has(entity) ? facing[slot] : 0;
        const hp = renderComponents.health.has(entity) ? renderComponents.health.partitions.hp[slot] : 0;
        rendered.push(`${entity}:${posX[slot]},${posY[slot]}:${dir}:${hp}`);
      }
    },
  });

  world.systems.create(renderSystem)();

  assertEquals(
    rendered,
    [`${withFacing}:1,2:2:0`, `${noFacing}:3,4:0:0`, `${withHealth}:5,6:0:9`],
    "Expected render fixture to use direct partitions and included ownership checks",
  );
});

Deno.test("include query validation rejects overlap and include-only specs", () => {
  const { Drawable, Facing, GridPos } = gameComponents();

  assertThrows(
    () => new Query({ include: [Facing] }),
    SpecError,
    "Query specification object is invalid",
  );
  assertThrows(
    () => new Query({ all: [GridPos], include: [GridPos] }),
    SpecError,
    "Query specification object is invalid",
  );
  assertThrows(
    () => new Query({ any: [Drawable], include: [Drawable] }),
    SpecError,
    "Query specification object is invalid",
  );
  assertThrows(
    () => new Query({ none: [Facing], include: [Facing] }),
    SpecError,
    "Query specification object is invalid",
  );
});

Deno.test("instance and world changed marking are ownership guarded and allocation-free reads preserve out on false", async () => {
  const { Door, Drawable, Facing, GridPos } = gameComponents();
  const unregistered = new Component<FacingValue, FacingStorage>({
    name: "unregisteredFacing",
    schema: { dir: Uint8Array },
  });
  const inactiveWorld = new World({ capacity: 8, components: [Facing] });
  const world = await createTestWorld([GridPos, Facing, Drawable, Door], 8);
  const owner = createEntity(world);
  const nonOwner = createEntity(world);
  const inactive = createEntity(world);
  world.entities.destroy(inactive);
  world.components.addBundle(owner, [
    [GridPos, { x: 1, y: 2 }],
    [Facing, { dir: 0 }],
    [Drawable],
  ]);

  const facing = world.components.require(Facing);
  const drawable = world.components.require(Drawable);
  world.refresh();

  facing.partitions.dir[entityIndex(owner)] = 3;
  assertEquals(ids(world.components.getChanged(Facing)), [], "Expected direct partition write not to mark changed");
  assertStrictEquals(facing.markChanged(owner), true, "Expected owner data instance marking to succeed");
  assertStrictEquals(facing.markChanged(owner), true, "Expected duplicate owner marking to stay successful");
  assertEquals(ids(world.components.getChanged(Facing)), [owner], "Expected changed list to include owner once");
  assertStrictEquals(facing.markChanged(nonOwner), false, "Expected non-owner instance marking to fail");
  assertStrictEquals(drawable.markChanged(owner), false, "Expected tag instance marking to fail");

  world.refresh();
  world.components.markChanged(Facing, owner);
  assertEquals(ids(world.components.getChanged(Facing)), [owner], "Expected world markChanged to mark owner");
  assertThrows(
    () => world.components.markChanged(Facing, nonOwner),
    ComponentOwnershipError,
    "does not own component",
  );
  assertThrows(
    () => world.components.markChanged(Facing, inactive),
    EntityNotFoundError,
    "is not active",
  );
  assertThrows(
    () => world.components.markChanged(Drawable, owner),
    ComponentDataError,
    "has no data storage",
  );
  assertThrows(
    () => world.components.markChanged(unregistered, owner),
    NotRegisteredError,
    "not registered",
  );
  assertThrows(
    () => inactiveWorld.components.markChanged(Facing, owner),
    WorldStateError,
    "initialized",
  );

  const out = { dir: 99, extra: 7 };
  assertStrictEquals(world.components.readEntityDataInto(Facing, owner, out), true, "Expected readInto success");
  assertEquals(out, { dir: 3, extra: 7 }, "Expected readInto to overwrite component keys only");

  const unchanged = { dir: 11, extra: 5 };
  assertStrictEquals(
    world.components.readEntityDataInto(Facing, nonOwner, unchanged),
    false,
    "Expected non-owner readInto to return false",
  );
  assertEquals(unchanged, { dir: 11, extra: 5 }, "Expected non-owner readInto to leave out unchanged");
  assertStrictEquals(
    world.components.readEntityDataInto(Facing, inactive, unchanged),
    false,
    "Expected inactive readInto to return false",
  );
  assertEquals(unchanged, { dir: 11, extra: 5 }, "Expected inactive readInto to leave out unchanged");
  assertStrictEquals(
    world.components.readEntityDataInto(Drawable, owner, unchanged),
    false,
    "Expected tag readInto to return false",
  );
  assertThrows(
    () => world.components.readEntityDataInto(unregistered, owner, unchanged),
    NotRegisteredError,
    "not registered",
  );
});

Deno.test("bundles and spawn APIs preflight before mutation and move once to the final archetype", async () => {
  const { Drawable, Facing, GridPos, Health } = gameComponents();
  const world = await createTestWorld([GridPos, Facing, Drawable, Health], 8);
  const intermediate = new Query({ all: [GridPos], none: [Drawable] });
  assertEquals(listIds(world.entities.queryList(intermediate)), [], "Expected intermediate query to be registered");

  const entity = createEntity(world);
  world.components.addBundle(entity, [
    [GridPos, { x: 1, y: 2 }],
    [Facing, { dir: 1 }],
    [Drawable],
  ]);

  assertEquals(world.components.getEntityData(GridPos, entity), { x: 1, y: 2 }, "Expected bundle data");
  assertEquals(world.components.getEntityData(Facing, entity), { dir: 1 }, "Expected branded bundle data");
  assertEquals(ids(world.components.getChanged(GridPos)), [entity], "Expected bundle data to be changed");
  assertEquals(ids(world.components.getChanged(Facing)), [entity], "Expected branded bundle data to be changed");
  assertEquals(
    ids(world.archetypes.queryExited(intermediate)),
    [],
    "Expected bundle add to skip intermediate archetype transitions",
  );

  world.refresh();
  world.components.addBundle(entity, [
    [GridPos, { x: 5 }],
    [Drawable],
  ]);
  assertEquals(world.components.getEntityData(GridPos, entity), { x: 5, y: 2 }, "Expected bundle upsert");
  assertEquals(ids(world.components.getChanged(GridPos)), [entity], "Expected upsert data to mark changed");

  const spawned = world.entities.createWith([
    [GridPos, { x: 9, y: 10 }],
    [Facing, { dir: 2 }],
    [Drawable],
  ]);
  assert(spawned !== undefined, "Expected createWith to return an entity");
  assertEquals(world.components.getEntityData(Facing, spawned), { dir: 2 }, "Expected createWith bundle data");

  const spawnedOrThrow = world.entities.createWithOrThrow([
    [GridPos, { x: 11, y: 12 }],
    [Health, { hp: 100 }],
  ]);
  assertEquals(world.components.getEntityData(Health, spawnedOrThrow), { hp: 100 }, "Expected createWithOrThrow data");
});

Deno.test("bundle validation rejects duplicate, unregistered, inactive, tag-data, capped, and full-world cases atomically", async () => {
  const { Drawable, Facing, GridPos } = gameComponents();
  const unregistered = new Component<GridPosValue, GridPosStorage>({
    name: "unregisteredGridPos",
    schema: { x: Int16Array, y: Int16Array },
  });
  const world = await createTestWorld([GridPos, Facing, Drawable], 8);
  const entity = createEntity(world);
  const inactive = createEntity(world);
  world.components.addBundle(entity, [[GridPos, { x: 1, y: 2 }]]);
  world.refresh();
  world.entities.destroy(inactive);

  assertThrows(
    () =>
      world.components.addBundle(entity, [
        [Facing, { dir: 0 }],
        [Facing, { dir: 1 }],
      ]),
    RangeError,
    "Duplicate component",
  );
  assert(!world.components.entityHas(Facing, entity), "Expected duplicate bundle to leave ownership unchanged");

  assertThrows(
    () => world.components.addBundle(entity, [[unregistered, { x: 9, y: 9 }]]),
    NotRegisteredError,
    "not registered",
  );
  assertEquals(
    world.components.getEntityData(GridPos, entity),
    { x: 1, y: 2 },
    "Expected unregistered bundle atomicity",
  );

  assertThrows(
    () => world.components.addBundle(inactive, [[Facing, { dir: 2 }]]),
    EntityNotFoundError,
    "is not active",
  );
  assertThrows(
    () =>
      (
        world.components.addBundle as unknown as (
          target: number,
          bundle: readonly ComponentBundleEntryInput[],
        ) => void
      )(entity, [[Drawable, {}]] as unknown as readonly ComponentBundleEntryInput[]),
    ComponentDataError,
    "has no data storage",
  );
  assert(!world.components.entityHas(Drawable, entity), "Expected tag-data bundle to leave ownership unchanged");

  const limited = new Component<{ value: number }, { value: Uint8ArrayConstructor }>({
    name: "limited",
    schema: { value: Uint8Array },
    maxEntities: 1,
  });
  const cappedWorld = await createTestWorld([limited], 8);
  const first = createEntity(cappedWorld);
  const beforeActive = cappedWorld.entities.getActiveCount();
  cappedWorld.components.addBundle(first, [[limited, { value: 1 }]]);
  assertThrows(
    () => cappedWorld.entities.createWith([[limited, { value: 2 }]]),
    RangeError,
    "can only be added",
  );
  assertStrictEquals(
    cappedWorld.entities.getActiveCount(),
    beforeActive,
    "Expected failed createWith to roll back the new entity",
  );

  const fullWorld = await createTestWorld([GridPos], 8);
  for (let i = 0; i < 8; i++) {
    fullWorld.entities.createOrThrow();
  }
  assertStrictEquals(fullWorld.entities.createWith([[GridPos, { x: 1, y: 1 }]]), undefined, "Expected soft cap");
  assertThrows(
    () => fullWorld.entities.createWithOrThrow([[GridPos, { x: 1, y: 1 }]]),
    CapacityError,
    "capacity",
  );
});
