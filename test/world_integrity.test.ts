/// <reference lib="deno.ns" />

import {
  asEntity,
  asSlotIndex,
  CapacityError,
  type Entity,
  entityIndex,
  Query,
  World,
  WorldRollbackScope,
  WorldStateError,
} from "../mod.ts";
import { EntityManager } from "../src/entity/entity-manager.ts";
import { createEntity, createTestWorld, tagComponent, vec2Component } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows, ids } from "./helpers.ts";

Deno.test("rollback restores the stable entity authority without reissuing speculative handles", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);
  const original = createEntity(world);
  world.components.addToEntity(position, original, { x: 1 });
  const query = new Query({ all: [position] });
  const point = new WorldRollbackScope(world);
  world.entities.destroy(original);
  const discarded = createEntity(world);
  world.components.addToEntity(position, discarded, { x: 9 });
  point.restore();
  assert(world.entities.isActive(original), "Facade must use restored entity authority");
  assert(!world.entities.isActive(discarded), "Speculative handle must be invalidated");
  assertEquals(world.entities.getActiveSnapshot(), [original], "Active snapshot must restore");
  assertEquals(world.entities.querySnapshot(query), [original], "Query must agree with active facade");
  world.entities.destroy(original);
  const replacement = createEntity(world);
  assert(replacement !== discarded, "Restoring a live generation must retain issuance history");
  world.entities.destroy(replacement);
  for (let index = 0; index < 3; index++) {
    const emptyPoint = new WorldRollbackScope(world);
    const speculative = createEntity(world);
    emptyPoint.restore();
    const next = createEntity(world);
    assert(next !== speculative, "Empty-world rollback must retire speculative generations");
    world.entities.destroy(next);
  }
  await world.destroy();
});

Deno.test("rollback restores changed and transition windows and advances query revisions", async () => {
  const position = vec2Component();
  const tag = tagComponent("tag");
  const world = await createTestWorld([position, tag]);
  const entity = createEntity(world);
  world.components.addToEntity(position, entity, { x: 1 });
  world.refresh();
  world.components.setEntityData(position, entity, { x: 2 });
  const query = new Query({ all: [position], none: [tag] });
  const entered = ids(world.entities.queryEntered(query));
  const exited = ids(world.entities.queryExited(query));
  const changed = ids(world.components.getChanged(position));
  const point = new WorldRollbackScope(world);
  world.components.addToEntity(tag, entity);
  world.refresh();
  const beforeRestore = world.queryRevision(query);
  point.restore();
  assertEquals(ids(world.entities.queryEntered(query)), entered, "Rollback must restore entered window");
  assertEquals(ids(world.entities.queryExited(query)), exited, "Rollback must restore exited window");
  assertEquals(ids(world.components.getChanged(position)), changed, "Rollback must restore changed window");
  assert(world.queryRevision(query) > beforeRestore, "Restore must advance observed query revision");
  await world.destroy();
});

Deno.test("historical exits retain each departed generation and reject stale archetype identity", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position], 8);
  const query = new Query({ all: [position] });
  const departed: Entity[] = [];
  for (let index = 0; index < 20; index++) {
    const entity = createEntity(world);
    world.components.addToEntity(position, entity);
    // Exits are relative to the window start, so the entity must be a member before the window opens.
    world.refresh();
    world.entities.destroy(entity);
    assertEquals(ids(world.entities.queryExited(query)), [entity], "Exits must preserve complete handles");
    departed.push(entity);
  }
  assertEquals(new Set(departed).size, 20, "Every recycled generation must produce a distinct handle");
  assertEquals(world.archetypes.getEntityArchetype(departed[0]!), undefined, "Stale handle has no archetype");
  assertEquals(world.archetypes.isEntityInRoot(departed[0]!), false, "Stale handle cannot identify replacement");
  world.refresh();
  assertEquals(ids(world.entities.queryExited(query)), [], "Refresh clears historical exits");
  await world.destroy();
});

Deno.test("batch mutations reject mismatched and malformed slot entries before changing ownership", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const a = createEntity(world);
  const b = createEntity(world);
  world.components.addToEntity(position, a);
  world.components.addToEntity(position, b);
  const forged = { count: 1, entities: [a], slots: [entityIndex(b)] };
  assertThrows(() => world.components.removeFromEntities(position, forged), RangeError, "invalid storage slot");
  assertThrows(() => world.components.addToEntities(position, forged), RangeError, "invalid storage slot");
  assertThrows(
    () => world.components.removeFromEntities(position, { count: 2, entities: [a], slots: [entityIndex(a)] }),
    Error,
    "not active",
  );
  const query = new Query({ all: [position] });
  assertEquals(world.entities.querySnapshot(query), [a, b], "Invalid batches must preserve archetype ownership");
  assertEquals(
    world.components.removeFromEntities(position, world.entities.queryList(query)),
    2,
    "Failed preflight clears scratch",
  );
  assert(!world.entities.isActive(asEntity(NaN)), "Malformed handles cannot alias slot zero");
  await world.destroy();
});

Deno.test("checkpoint restores tags and capped memberships atomically, including outside owners", async () => {
  const position = vec2Component();
  const capped = vec2Component("capped", { maxEntities: 1 });
  const tag = tagComponent("tag");
  const world = await createTestWorld([position, capped, tag]);
  const a = createEntity(world);
  const b = createEntity(world);
  const outside = createEntity(world);
  world.components.addToEntity(position, a, { x: 1 });
  world.components.addToEntity(capped, a, { x: 3 });
  world.components.addToEntity(tag, a);
  const checkpoint = world.captureCheckpoint([a, b], position, capped, tag);
  world.components.setEntityData(position, a, { x: 9 });
  world.components.removeFromEntity(capped, a);
  world.components.addToEntity(capped, b, { x: 8 });
  world.components.removeFromEntity(tag, a);
  world.applyCheckpoint(checkpoint);
  assertEquals(world.components.getEntityData(position, a).x, 1, "Value must restore alongside membership");
  assertEquals(world.components.getEntityData(capped, a).x, 3, "Capped membership can transfer back");
  assert(world.components.entityHas(tag, a), "Present tag must restore without a data payload");
  assert(!world.components.entityHas(capped, b), "Speculative captured owner must be removed");
  world.components.removeFromEntity(capped, a);
  world.components.addToEntity(capped, outside);
  world.components.setEntityData(position, a, { x: 9 });
  assertThrows(() => world.applyCheckpoint(checkpoint), Error, "maximum owner count");
  assertEquals(world.components.getEntityData(position, a).x, 9, "Failed checkpoint must preserve preceding values");
  assert(world.components.entityHas(capped, outside), "Failed checkpoint must preserve external ownership");
  await world.destroy();
});

Deno.test("rollback scopes reject uninitialized and destroyed worlds", async () => {
  const world = new World({ capacity: 8, components: [tagComponent("tag")] });
  assertThrows(() => new WorldRollbackScope(world), WorldStateError, "not been initialized");
  await world.init();
  const point = new WorldRollbackScope(world);
  await world.destroy();
  assertThrows(() => point.restore(), WorldStateError, "destroyed");
  assert(!point.isOpen, "A failed restore still closes the scope");
  assertThrows(() => point.commit(), WorldStateError, "already closed");
});

Deno.test("entity generation allocation retains the packed 15-bit wrap contract", () => {
  const manager = new EntityManager(1);
  for (let generation = 0; generation < 32769; generation++) {
    const entity = manager.create()!;
    assertEquals(entity, asEntity((generation & 32767) << 16), "Packed generations must wrap");
    assert(manager.isActive(entity), "Wrapped generation must remain active");
    manager.destroy(entity);
    assert(!manager.isActive(entity), "Destroyed handle must remain inactive");
  }
});

Deno.test("same-handle leave, reenter, and leave records one historical exit", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const entity = createEntity(world);
  const query = new Query({ all: [position] });
  world.components.addToEntity(position, entity);
  world.refresh();
  world.components.removeFromEntity(position, entity);
  world.components.addToEntity(position, entity);
  world.components.removeFromEntity(position, entity);
  assertEquals(ids(world.entities.queryExited(query)), [entity], "Repeated exit must deduplicate the same handle");
  await world.destroy();
});

Deno.test("failed spawn preflight preserves lifecycle windows, revisions, and handle allocation", async () => {
  const position = vec2Component();
  const capped = vec2Component("capped", { maxEntities: 1 });
  const world = await createTestWorld([position, capped]);
  const owner = world.entities.createWithOrThrow([[capped]]);
  const query = new Query({ none: [position] });
  world.entities.queryList(query);
  world.refresh();
  const revision = world.queryRevision(query);

  assertThrows(
    () => world.entities.createWithOrThrow([[position, { x: Number.MAX_VALUE }]]),
    TypeError,
    "outside its storage range",
  );
  assertThrows(() => world.entities.createWith([[capped]]), RangeError, "can only be added");
  assertThrows(() => world.entities.createWith([[position], [position]]), RangeError, "Duplicate component");
  assertEquals(world.entities.getActiveSnapshot(), [owner], "Failed spawn must preserve active handles");
  assertEquals(ids(world.entities.queryEntered(query)), [], "Failed spawn must not publish entries");
  assertEquals(ids(world.entities.queryExited(query)), [], "Failed spawn must not publish phantom exits");
  assertEquals(world.queryRevision(query), revision, "Failed spawn must not advance query revisions");
  assertEquals(
    world.entities.createWithOrThrow([[position, { x: 2 }]]),
    asEntity(1),
    "No handles are allocated on failure",
  );
  await world.destroy();
});

Deno.test("full-world bundle creation reports payload errors before capacity errors", async () => {
  const position = vec2Component();
  const world = await createTestWorld([position]);
  const entities = Array.from({ length: world.entities.capacity }, () => world.entities.createOrThrow());
  assertThrows(
    () => world.entities.createWith([[position, { x: Number.MAX_VALUE }]]),
    TypeError,
    "outside its storage range",
  );
  assertThrows(
    () => world.entities.createWithOrThrow([[position, { x: Number.MAX_VALUE }]]),
    TypeError,
    "outside its storage range",
  );
  assertEquals(
    world.entities.createWith([[position, { x: 1 }]]),
    undefined,
    "Soft capacity failure must return undefined for a valid payload",
  );
  assertThrows(
    () => world.entities.createWithOrThrow([[position, { x: 1 }]]),
    CapacityError,
    "capacity",
  );
  assertEquals(world.entities.getActiveSnapshot(), entities, "Capacity failure must preserve active handles");
  await world.destroy();
});

Deno.test("active iteration bounds select raw slots across recycled entity generations", async () => {
  const world = await createTestWorld([tagComponent("tag")]);
  const first = world.entities.createOrThrow();
  const second = world.entities.createOrThrow();
  world.entities.destroy(first);
  // Next-fit reuse: occupy every other free slot so the allocator wraps back to slot 0.
  const capacity = world.entities.capacity;
  for (let slot = 2; slot < capacity; slot++) world.entities.createOrThrow();
  const recycled = world.entities.createOrThrow();
  assertStrictEquals(entityIndex(recycled), 0, "The allocator wraps back to the freed slot");
  assert(recycled !== first, "The slot must carry a recycled generation");
  assertEquals(
    ids(world.entities.getActive(entityIndex(recycled), asSlotIndex(1))),
    [recycled],
    "Raw bounds must include the recycled handle and exclude the upper slot",
  );
  assertEquals(
    world.entities.getActiveSnapshot(entityIndex(second), asSlotIndex(2)),
    [second],
    "Raw bounds select only the requested slot range",
  );
  assertStrictEquals(
    world.entities.getActiveSnapshot(entityIndex(second), asSlotIndex(capacity)).length,
    capacity - 1,
    "Capacity is a valid exclusive upper bound",
  );
  await world.destroy();
});
