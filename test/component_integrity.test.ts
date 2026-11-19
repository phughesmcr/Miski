/// <reference lib="deno.ns" />

import {
  ArgumentError,
  asEntity,
  canonicalizeStoredValue,
  CapacityError,
  compileComponentSchema,
  Component,
  ComponentDataError,
  ComponentOwnershipError,
  type DynamicComponent,
  entityIndex,
  EntityNotFoundError,
  NotRegisteredError,
  Query,
  type QueryEntityList,
  SpecError,
  WorldRollbackScope,
} from "../mod.ts";
import { createEntity, createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows, ids } from "./helpers.ts";

Deno.test("component schemas reject proxy cursor fields at every constructor boundary", () => {
  for (const key of ["entity", "slot"]) {
    const schema = { [key]: Float32Array, x: Float32Array };
    assertThrows(() => new Component({ name: "position", schema }), SpecError, "Invalid component specification");
    assertThrows(() => compileComponentSchema({ position: schema }), SpecError, "Invalid component specification");
  }
});

Deno.test("dense and capped storage initialize every new owner with zero defaults", async () => {
  for (const maxOwners of [undefined, 4]) {
    const position = vec2Component("position", { maxOwners });
    const world = await createTestWorld([position]);
    const instance = world.components.getInstanceOrThrow(position);
    const bundled = world.entities.createOrThrow([[position]]);
    const single = createEntity(world);
    world.components.addToEntity(position, single);
    const batched = createEntity(world);
    world.components.addToEntities(position, {
      count: 1,
      entities: [batched],
      slots: [entityIndex(batched)],
    });
    const emptyPayload = world.entities.createOrThrow([[position, {}]]);
    for (const entity of [bundled, single, batched, emptyPayload]) {
      assertEquals(
        world.components.getEntityDataOrThrow(position, entity),
        { x: 0, y: 0 },
        "New ownership defaults to zero",
      );
      assertEquals(instance.get(entity, "x"), 0, "Guarded reads agree with copied data");
      instance.proxy!.entity = entity;
      assertEquals(instance.proxy!.y, 0, "Proxy reads agree with copied data");
    }
    const checkpoint = world.captureCheckpoint([bundled, single, batched, emptyPayload], position);
    instance.set(single, "x", 9);
    world.applyCheckpoint(checkpoint);
    assertEquals(instance.get(single, "x"), 0, "Default data survives a checkpoint roundtrip");
    world.components.setEntityData(position, single, { x: 3, y: 4 });
    world.components.removeFromEntity(position, single);
    world.components.addToEntity(position, single);
    assertEquals(
      world.components.getEntityDataOrThrow(position, single),
      { x: 0, y: 0 },
      "Reacquired storage clears prior values",
    );
    world.refresh();
    const revision = instance.revision;
    world.components.addToEntity(position, single);
    assertEquals(instance.revision, revision, "Adding an existing owner without data is idempotent");
    assertEquals(
      ids(world.components.getChanged(position)),
      [],
      "Default-only ownership does not mark numeric changes",
    );
    await world.destroy();
  }
});

Deno.test("component entity access rejects stale, malformed and unowned identities", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const old = world.entities.createOrThrow([[position, { x: 1 }]]);
  const instance = world.components.getInstanceOrThrow(position);
  instance.proxy!.entity = old;
  world.entities.destroy(old);
  const replacement = world.entities.createOrThrow([[position, { x: 2 }]]);
  for (const entity of [old, asEntity(-1), asEntity(0.5), asEntity(Number.NaN), asEntity(2 ** 32 + replacement)]) {
    assert(!instance.has(entity), "Stale and noncanonical handles must not own replacement storage");
    assert(!world.components.entityHas(position, entity), "Manager ownership must validate identity");
    assert(!instance.markChanged(entity), "Stale changed markers must fail");
    assertThrows(() => instance.get(entity, "x"), ComponentOwnershipError, "does not own");
    assertThrows(() => instance.set(entity, "x", 9), Error, "");
  }
  assertThrows(
    () => {
      instance.proxy!.x = 10;
    },
    ComponentOwnershipError,
    "does not own",
  );
  assertEquals(instance.get(replacement, "x"), 2, "Rejected stale writes preserve replacement data");
  world.components.removeFromEntity(position, replacement);
  assertThrows(() => instance.get(replacement, "x"), ComponentOwnershipError, "does not own");
});

Deno.test("slot cursor marks the actual slot and every real write advances revisions", async () => {
  const position = vec2Component();
  const tag = tagComponent("tag");
  const world = await createTestWorld([position, tag]);
  const a = world.entities.createOrThrow([[position, { x: 1 }]]);
  const b = world.entities.createOrThrow([[position, { x: 2 }]]);
  const instance = world.components.getInstanceOrThrow(position);
  instance.set(a, "x", 3);
  world.refresh();
  let revision = instance.revision;
  instance.set(b, "x", 4);
  assertEquals(ids(world.components.getChanged(position)), [b], "instance.set must not reuse a prior entity cursor");
  assert(instance.revision > revision, "First write advances revision");
  revision = instance.revision;
  instance.set(b, "y", 5);
  assert(instance.revision > revision, "Dirty-list dedup must not suppress later revision advances");
  revision = instance.revision;
  instance.set(b, "y", 5);
  assertEquals(instance.revision, revision, "Idempotent writes preserve revision");
  assertEquals(ids(world.components.getChanged(position)), [b], "Changed list remains deduplicated");
  const tagInstance = world.components.getInstanceOrThrow(tag);
  revision = tagInstance.revision;
  world.components.addToEntity(tag, a);
  assert(tagInstance.revision > revision, "Uncapped tag membership advances revision");
});

Deno.test("dense and capped sparse storage share atomic canonical numeric writes", async () => {
  for (const maxOwners of [undefined, 2]) {
    const position = vec2Component("position", { maxOwners });
    const world = await createTestWorld([position]);
    const entity = world.entities.createOrThrow([[position, { x: 1, y: 1 }]]);
    const instance = world.components.getInstanceOrThrow(position);
    world.refresh();
    const revision = instance.revision;
    for (
      const write of [
        () => world.components.setEntityData(position, entity, { x: 2, y: Number.MAX_VALUE }),
        () => world.components.addToEntity(position, entity, { x: 2, y: Number.MAX_VALUE }),
        () => instance.set(entity, "x", Number.MAX_VALUE),
      ]
    ) assertThrows(write, ComponentDataError, "outside its storage range");
    assertEquals(
      world.components.getEntityDataOrThrow(position, entity),
      { x: 1, y: 1 },
      "Preflight rejects partial writes",
    );
    assertEquals(instance.revision, revision, "Rejected writes preserve revision");
    assertEquals(ids(world.components.getChanged(position)), [], "Rejected writes preserve dirty state");
    world.components.addToEntity(position, entity, Object.create({ x: 99 }));
    assertEquals(instance.get(entity, "x"), 1, "Inherited values must never enter storage");
    world.components.setEntityData(position, entity, { x: 1.1, y: -Number.MIN_VALUE });
    assertEquals(instance.get(entity, "x"), Math.fround(1.1), "Writes use declared column coercion");
    assert(Object.is(instance.get(entity, "y"), 0), "Canonical writes normalize negative zero after coercion");
    const next = createEntity(world);
    assertThrows(
      () => world.components.addToEntity(position, next, { x: Number.MAX_VALUE }),
      ComponentDataError,
      "outside its storage range",
    );
    assert(!instance.has(next), "Failed additions never acquire ownership");
  }
});

Deno.test("rollback restores capped mappings and pre-scope changes with fresh revision tokens", async () => {
  const position = new Component({ name: "position", schema: { x: Float32Array, y: Float32Array }, maxOwners: 2 });
  const world = await createTestWorld([position]);
  const first = world.entities.createOrThrow([[position, { x: 1, y: 2 }]]);
  const second = world.entities.createOrThrow([[position, { x: 3, y: 4 }]]);
  world.refresh();
  const instance = world.components.getInstanceOrThrow(position);
  instance.set(first, "x", 5);
  const point = new WorldRollbackScope(world);
  world.components.removeFromEntity(position, first);
  world.components.setEntityData(position, second, { x: 8, y: 9 });
  const third = world.entities.createOrThrow([[position, { x: 10, y: 11 }]]);
  const revision = instance.revision;
  point.restore();
  assertEquals(world.components.getEntityDataOrThrow(position, first), { x: 5, y: 2 }, "Restore first sparse mapping");
  assertEquals(world.components.getEntityDataOrThrow(position, second), { x: 3, y: 4 }, "Restore other shared columns");
  assert(!instance.has(third), "Discard speculative owner");
  assertEquals(ids(world.components.getChanged(position)), [first], "Restore original changed window");
  assert(instance.revision > revision, "Rollback never reuses component revision tokens");
});

Deno.test("component string lookup only resolves registered own names", async () => {
  const component = tagComponent("tag");
  const world = await createTestWorld([component]);
  assertEquals(world.components.getInstanceOrThrow("tag").name, "tag", "Registered own name is valid");
  for (const name of ["constructor", "toString", "__proto__", "valueOf"]) {
    assert(!world.components.isRegistered(name), "Inherited object properties are not registered components");
    assertThrows(() => world.components.getInstanceOrThrow(name), NotRegisteredError, "not registered");
  }
});

Deno.test("bundle and batch commits keep canonical scratch values isolated by component", async () => {
  const first = vec2Component("first");
  const second = vec2Component("second");
  const world = await createTestWorld([first, second]);
  const a = world.entities.createOrThrow([[first, { x: 1.1 }], [second, { x: 2.2 }]]);
  const b = world.entities.createOrThrow([[second, { x: 3.3 }]]);
  assertEquals(
    world.components.getInstanceOrThrow(first).get(a, "x"),
    Math.fround(1.1),
    "Each bundle member keeps its own canonical data",
  );
  assertEquals(
    world.components.getInstanceOrThrow(second).get(a, "x"),
    Math.fround(2.2),
    "Second member does not overwrite first scratch",
  );
  const entities = {
    count: 2,
    entities: new Uint32Array([a, b]),
    slots: new Uint32Array([entityIndex(a), entityIndex(b)]),
  };
  world.components.addToEntities(first, entities, { x: 4.4, y: 5.5 });
  for (const entity of [a, b]) {
    assertEquals(
      world.components.getEntityDataOrThrow(first, entity),
      { x: Math.fround(4.4), y: Math.fround(5.5) },
      "Batch repeats staged canonical payload",
    );
  }
});

Deno.test("component lookup works whether the world's definition ids are compact or spread out", async () => {
  const first = vec2Component("spreadFirst");
  const unregistered = tagComponent("spreadUnregistered");
  // Definition ids are process-global: many definitions between two components spread a world's ids out.
  for (let i = 0; i < 500; i++) tagComponent(`spreadFiller${i}`);
  const last = vec2Component("spreadLast");
  for (const components of [[first, unregistered], [first, last]] as DynamicComponent[][]) {
    const world = await createTestWorld(components, 8);
    const entity = createEntity(world);
    for (const component of components) {
      assert(world.components.isRegistered(component), `${component.name} is registered`);
      world.components.addToEntity(component as never, entity);
      assert(world.components.entityHas(component, entity), `${component.name} is found by definition`);
    }
    const missing = components.includes(last) ? unregistered : last;
    assert(!world.components.isRegistered(missing), `${missing.name} is not registered`);
    assertEquals(world.components.getInstance(missing), undefined, "an unregistered lookup is undefined");
  }
});

Deno.test("canonicalizeStoredValue coerces through typed storage", () => {
  const scratch = new Int8Array(1);
  assertStrictEquals(canonicalizeStoredValue("Face", "dir", -0, scratch), 0, "-0 becomes 0");
  assertStrictEquals(
    canonicalizeStoredValue("Face", "dir", 999, scratch),
    -25,
    "Int8 truncates overflow to stored bits",
  );
  assertThrows(
    () => canonicalizeStoredValue("Face", "dir", Number.NaN, scratch),
    ComponentDataError,
    "finite number",
  );
  const floatScratch = new Float32Array(1);
  assertThrows(
    () => canonicalizeStoredValue("Pos", "x", Number.POSITIVE_INFINITY, floatScratch),
    ComponentDataError,
    "finite number",
  );
});

Deno.test("public component writes reject invalid data instead of silently discarding it", async () => {
  const position = vec2Component();
  const renderable = tagComponent("renderable");
  const renderableAsData = renderable as unknown as typeof position;
  const world = await createTestWorld([position, renderable], 8);
  const entity = createEntity(world);

  assertThrows(
    () => world.components.addToEntity(renderableAsData, entity, {}),
    ComponentDataError,
    "has no data storage",
  );
  assertThrows(
    () => world.components.addToEntity(position, entity, { z: 1 } as never),
    ComponentDataError,
    'does not define data field "z"',
  );
  assertThrows(
    () => world.components.addToEntity(position, entity, { constructor: 1 } as never),
    ComponentDataError,
    'does not define data field "constructor"',
  );

  world.components.addToEntity(position, entity, { x: 1, y: 2 });

  assertThrows(
    () => world.components.setEntityData(position, entity, { x: undefined } as never),
    ComponentDataError,
    'data field "x" cannot be undefined',
  );
  assertThrows(
    () => world.components.setEntityData(position, entity, { constructor: 1 } as never),
    ComponentDataError,
    'does not define data field "constructor"',
  );
  const inheritedData = Object.create({ x: 99, z: 3 }) as Partial<{ x: number; y: number }>;
  world.components.setEntityData(position, entity, inheritedData);
  assertThrows(
    () =>
      world.components.addToEntities(
        renderableAsData,
        { count: 1, entities: [entity], slots: [entityIndex(entity)] },
        {},
      ),
    ComponentDataError,
    "has no data storage",
  );
  assertEquals(
    world.components.getEntityDataOrThrow(position, entity),
    { x: 1, y: 2 },
    "Expected failed and inherited-property writes to be inert",
  );
});

Deno.test("components cannot be added to inactive entities", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);

  assert(!world.entities.isActive(asEntity(3)), "Expected entity 3 to be inactive");
  assertThrows(
    () => world.components.addToEntity(position, asEntity(3), { x: 1, y: 2 }),
    EntityNotFoundError,
    "Entity 3 is not active.",
  );

  assertEquals(ids(world.entities.query(new Query({ all: [position] }))), [], "Expected inactive entity to not match");
});

Deno.test("component removal rejects inactive entities and stays idempotent for active non-owners", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity], 8);

  const owner = createEntity(world);
  const nonOwner = createEntity(world);
  world.components.addToEntity(position, owner, { x: 1, y: 2 });
  world.components.addToEntity(position, nonOwner, { x: 3, y: 4 });
  world.components.addToEntity(velocity, owner, { x: 5, y: 6 });

  assertThrows(
    () => world.components.removeFromEntity(velocity, asEntity(7)),
    EntityNotFoundError,
    "Entity 7 is not active.",
  );

  world.components.removeFromEntity(velocity, nonOwner);
  assert(world.components.entityHas(position, nonOwner), "Expected non-owner removal to leave other ownership intact");
  assert(!world.components.entityHas(velocity, nonOwner), "Expected non-owner to remain without velocity");

  const list: QueryEntityList = {
    count: 2,
    entities: new Uint32Array([owner, nonOwner]),
    slots: new Uint32Array([owner, nonOwner]),
  };
  assertEquals(world.components.removeFromEntities(velocity, list), 1, "Expected only actual owners to be removed");
  assert(!world.components.entityHas(velocity, owner), "Expected owner to lose velocity");
  assert(world.components.entityHas(position, owner), "Expected batch removal to leave other ownership intact");
});

Deno.test("batch component removal rejects inactive entities without partial mutation", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);

  const first = createEntity(world);
  world.components.addToEntity(position, first, { x: 1, y: 2 });

  const list: QueryEntityList = {
    count: 2,
    entities: new Uint32Array([first, 7]),
    slots: new Uint32Array([first, 7]),
  };
  assertThrows(
    () => world.components.removeFromEntities(position, list),
    EntityNotFoundError,
    "Entity 7 is not active.",
  );
  assert(world.components.entityHas(position, first), "Expected failed batch removal to leave ownership intact");
  assertEquals(
    ids(world.entities.query(new Query({ all: [position] }))),
    [first],
    "Expected query state to stay intact",
  );
});

Deno.test("batch component add capacity failures leave all state unchanged", async () => {
  const player = tagComponent("player", { maxOwners: 1 });
  const world = await createTestWorld([player], 8);

  const first = createEntity(world);
  const second = createEntity(world);

  const list: QueryEntityList = {
    count: 2,
    entities: new Uint32Array([first, second]),
    slots: new Uint32Array([first, second]),
  };
  assertThrows(
    () => world.components.addToEntities(player, list),
    CapacityError,
    'Component "player" can only be added to 1 entities',
  );

  assert(!world.components.entityHas(player, first), "Expected first entity to remain without player");
  assert(!world.components.entityHas(player, second), "Expected second entity to remain without player");
  assertEquals(ids(world.components.getOwners(player)), [], "Expected owners to remain unchanged");
  assertEquals(ids(world.entities.query(new Query({ all: [player] }))), [], "Expected query state to remain unchanged");
});

Deno.test("batch component transitions reject duplicate entity targets before mutation", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const world = await createTestWorld([position, velocity], 8);

  const entity = createEntity(world);
  world.components.addToEntity(position, entity, { x: 1, y: 2 });

  const duplicateList: QueryEntityList = {
    count: 2,
    entities: new Uint32Array([entity, entity]),
    slots: new Uint32Array([entity, entity]),
  };
  assertThrows(
    () => world.components.addToEntities(velocity, duplicateList, { x: 3, y: 4 }),
    ArgumentError,
    "Duplicate entity",
  );

  assert(!world.components.entityHas(velocity, entity), "Expected duplicate batch add to leave ownership unchanged");
  assertEquals(ids(world.entities.query(new Query({ all: [position, velocity] }))), [], "Expected query state intact");
});

Deno.test("public component data APIs reject inactive, unregistered, tag, and non-owner access", async () => {
  const position = vec2Component();
  const velocity = vec2Component("velocity");
  const tag = tagComponent("tag");
  const unregistered = vec2Component("unregistered");
  const world = await createTestWorld([position, velocity, tag], 8);

  const owner = createEntity(world);
  const nonOwner = createEntity(world);
  world.components.addToEntity(position, owner, { x: 1, y: 2 });
  world.components.addToEntity(tag, owner);

  assertThrows(
    () => world.components.getEntityDataOrThrow(position, asEntity(7)),
    EntityNotFoundError,
    "Entity 7 is not active.",
  );
  assertThrows(
    () => world.components.setEntityData(position, asEntity(7), { x: 3, y: 4 }),
    EntityNotFoundError,
    "Entity 7 is not active.",
  );
  assertThrows(
    () => world.components.getEntityDataOrThrow(unregistered, owner),
    NotRegisteredError,
    "not registered",
  );
  assertThrows(
    () => world.components.setEntityData(unregistered, owner, { x: 3, y: 4 }),
    NotRegisteredError,
    "not registered",
  );
  assertThrows(
    () => world.components.getEntityDataOrThrow(tag, owner),
    ComponentDataError,
    "has no data storage",
  );
  assertThrows(
    () => world.components.setEntityData(tag as unknown as typeof position, owner, {}),
    ComponentDataError,
    "has no data storage",
  );
  assertThrows(
    () => world.components.getEntityDataOrThrow(velocity, nonOwner),
    ComponentOwnershipError,
    "does not own component",
  );
  assertThrows(
    () => world.components.setEntityData(velocity, nonOwner, { x: 3, y: 4 }),
    ComponentOwnershipError,
    "does not own component",
  );
});

Deno.test("failed guarded data access does not mark changed state or mutate storage", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);

  const owner = createEntity(world);
  const nonOwner = createEntity(world);
  world.components.addToEntity(position, owner, { x: 1, y: 2 });
  const instance = world.components.getInstance(position);
  assert(instance !== undefined && instance.storage !== null, "Expected position storage");
  const storage = instance.storage.partitions;
  storage.x[nonOwner] = 9;
  storage.y[nonOwner] = 10;
  world.refresh();

  assertThrows(
    () => world.components.setEntityData(position, nonOwner, { x: 99, y: 100 }),
    ComponentOwnershipError,
    "does not own component",
  );
  assertThrows(
    () => world.components.getEntityDataOrThrow(position, nonOwner),
    ComponentOwnershipError,
    "does not own component",
  );
  assertEquals(
    world.components.getEntityDataOrThrow(position, owner),
    { x: 1, y: 2 },
    "Expected owner data to be intact",
  );
  assertEquals(
    { x: storage.x[nonOwner], y: storage.y[nonOwner] },
    { x: 9, y: 10 },
    "Expected raw storage to be intact",
  );
  assertEquals(ids(world.components.getChanged(position)), [], "Expected failed guarded access to stay untracked");
});

Deno.test("components.getInstanceOrThrow returns registered instances and exposes storage", async () => {
  const position = vec2Component();
  const tag = tagComponent("tag");
  const world = await createTestWorld([position, tag], 8);

  const instance = world.components.getInstanceOrThrow(position);
  assert(instance === world.components.getInstance(position), "Expected getInstanceOrThrow to match getInstance");
  assert(instance.storage?.partitions != null, "Expected schema component partitions");

  const tagInstance = world.components.getInstanceOrThrow(tag);
  assertEquals(tagInstance.storage, null, "Expected tag component storage to be null");

  assertThrows(
    () => world.components.getInstanceOrThrow("missing"),
    NotRegisteredError,
    'Component "missing" is not registered in this world.',
  );
});

Deno.test("direct typed-array storage remains an unguarded data access escape hatch", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);

  const entity = createEntity(world);
  const instance = world.components.getInstance(position);
  assert(instance !== undefined && instance.storage !== null, "Expected position storage");

  instance.storage.partitions.x[entityIndex(entity)] = 12;
  instance.storage.partitions.y[entityIndex(entity)] = 13;
  assertEquals(
    { x: instance.storage.partitions.x[entityIndex(entity)], y: instance.storage.partitions.y[entityIndex(entity)] },
    { x: 12, y: 13 },
    "Expected raw storage writes to work without ownership checks",
  );
  assertThrows(
    () => world.components.getEntityDataOrThrow(position, entity),
    ComponentOwnershipError,
    "does not own component",
  );
});
