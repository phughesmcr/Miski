/// <reference lib="deno.ns" />

import {
  ArgumentError,
  CapacityError,
  CommandBuffer,
  Component,
  ComponentDataError,
  type DynamicComponent,
  field,
  NotRegisteredError,
  type PendingEntity,
  Relation,
  RelationCycleError,
  type World,
} from "../mod.ts";
import { createTestWorld, tagComponent } from "./fixtures.ts";
import { assert, assertEquals, assertStrictEquals, assertThrows } from "./helpers.ts";

const node = new Component({ name: "node", schema: { hp: Uint16Array, parent: field.entity() } });
const marker = tagComponent("marker");
const childOf = new Relation({ name: "childOf", exclusive: true, acyclic: true });
const likes = new Relation({ name: "likes", schema: { weight: Float32Array, rank: Int8Array } });
const unregisteredRelation = new Relation({ name: "unregistered" });

const components: DynamicComponent[] = [node, marker, childOf, likes];

async function setup(): Promise<{ world: World; commands: CommandBuffer }> {
  const world = await createTestWorld(components, 32);
  return { world, commands: new CommandBuffer(world) };
}

Deno.test("command buffer relate and unrelate mirror world.relations add and remove", async () => {
  const { world, commands } = await setup();
  const a = world.entities.createOrThrow();
  const b = world.entities.createOrThrow();
  const c = world.entities.createOrThrow();
  commands.relate(likes, a, b, { weight: 0.5 });
  commands.relate(likes, a, c);
  commands.relate(childOf, b, a);
  assertStrictEquals(commands.pendingCount, 3, "relation commands are counted");
  assertStrictEquals(world.relations.hasAny(likes, a), false, "nothing applies before flush");
  commands.flush();
  assertEquals(world.relations.getData(likes, a, b), { weight: 0.5, rank: 0 }, "pair data applied");
  assertEquals(world.relations.getData(likes, a, c), { weight: 0, rank: 0 }, "a pair without data starts at zero");
  assertStrictEquals(world.relations.getTarget(childOf, b), a, "exclusive pair applied");

  commands.relate(likes, a, b, { rank: 3 });
  commands.flush();
  assertEquals(world.relations.getData(likes, a, b), { weight: 0.5, rank: 3 }, "relating an existing pair merges data");

  commands.unrelate(likes, a, b);
  commands.unrelate(likes, b, c); // missing pair: skipped like the direct call
  commands.flush();
  assertStrictEquals(world.relations.has(likes, a, b), false, "pair removed");
  assertStrictEquals(world.relations.has(likes, a, c), true, "other pair kept");
  await world.destroy();
});

Deno.test("command buffer relate and unrelate accept pending entities at either end", async () => {
  const { world, commands } = await setup();
  const root = world.entities.createOrThrow();
  const parent = commands.spawn([[marker]]);
  const child = commands.spawn();
  commands.relate(childOf, parent, root);
  commands.relate(childOf, child, parent);
  commands.relate(likes, child, root, { weight: 2 });
  commands.flush();
  const [, spawnedParent, spawnedChild] = world.entities.toArray(world.relations.traverse(childOf, root));
  assert(spawnedParent !== undefined && spawnedChild !== undefined, "both spawns joined the hierarchy");
  assertStrictEquals(world.relations.getTarget(childOf, spawnedChild), spawnedParent, "pending -> pending pair");
  assertStrictEquals(world.components.entityHas(marker, spawnedParent), true, "parent spawn bundle applied");
  assertEquals(world.relations.getData(likes, spawnedChild, root), { weight: 2, rank: 0 }, "pending source with data");

  const doomed = commands.spawn();
  commands.relate(likes, root, doomed);
  commands.unrelate(likes, spawnedChild, root);
  commands.flush();
  assertStrictEquals(world.relations.getTargets(likes, root).count, 1, "pending target related");
  assertStrictEquals(world.relations.hasAny(likes, spawnedChild), false, "unrelate applied");
  await world.destroy();
});

Deno.test("command buffer validates relation commands when queued", async () => {
  const { world, commands } = await setup();
  const a = world.entities.createOrThrow();
  const b = world.entities.createOrThrow();
  assertThrows(() => commands.relate(unregisteredRelation, a, b), NotRegisteredError, "unregistered");
  assertThrows(() => commands.relate(node as never, a, b), ArgumentError, "not a relation");
  assertThrows(() => commands.relate(likes, a, b, { strength: 1 } as never), ComponentDataError, "strength");
  assertThrows(() => commands.relate(likes, a, b, { weight: Number.NaN }), ComponentDataError, "finite");
  assertThrows(() => commands.relate(likes, a, b, 5 as never), ComponentDataError, "object");
  assertThrows(() => commands.relate(likes, a, -1 as PendingEntity), ArgumentError, "pending");
  assertThrows(() => commands.unrelate(likes, -1 as PendingEntity, b), ArgumentError, "pending");
  assertThrows(() => commands.add(likes as never, a), ArgumentError, "relate and unrelate");
  assertStrictEquals(commands.pendingCount, 0, "rejected commands queue nothing");
  // A relation first seen (and cached) through a rejected component command still works with relate.
  const fresh = new CommandBuffer(world);
  assertThrows(() => fresh.spawn([[likes]] as never), ArgumentError, "relate and unrelate");
  assertThrows(() => fresh.add(likes as never, a), ArgumentError, "relate and unrelate");
  fresh.relate(likes, b, a, { rank: 2 });
  fresh.flush();
  assertEquals(world.relations.getData(likes, b, a), { weight: 0, rank: 2 }, "cached relation info is reused");
  commands.relate(likes, a, b, { weight: 1 });
  commands.flush();
  assertEquals(world.relations.getData(likes, a, b), { weight: 1, rank: 0 }, "a valid command still applies");
  await world.destroy();
});

Deno.test("command buffer skips relation commands whose source or target is no longer active", async () => {
  const { world, commands } = await setup();
  const a = world.entities.createOrThrow();
  const b = world.entities.createOrThrow();
  const c = world.entities.createOrThrow();
  commands.relate(likes, a, b);
  commands.destroy(b);
  commands.relate(likes, a, b);
  commands.relate(likes, b, c);
  commands.relate(likes, a, c);
  commands.flush();
  assertStrictEquals(world.relations.has(likes, a, c), true, "live pair applied");
  assertStrictEquals(world.relations.getTargets(likes, a).count, 1, "pairs with a dead end were skipped");
  await world.destroy();
});

Deno.test("command buffer relation failures drain the queue and name the pair", async () => {
  const { world, commands } = await setup();
  const a = world.entities.createOrThrow();
  const b = world.entities.createOrThrow();
  world.relations.add(childOf, b, a);
  commands.relate(childOf, a, b); // closes a cycle
  commands.relate(likes, a, b);
  assertThrows(
    () => commands.flush(),
    RelationCycleError,
    `CommandBuffer relate childOf on entity ${a} -> entity ${b} failed`,
  );
  assertStrictEquals(world.relations.has(likes, a, b), true, "later commands still applied");
  assertStrictEquals(world.relations.hasAny(childOf, a), false, "the failing pair was not added");
  await world.destroy();
});

Deno.test("command buffer resolves pending entities in field.entity() values", async () => {
  const { world, commands } = await setup();
  const parent = commands.spawn([[node, { hp: 1 }]]);
  const child = commands.spawn([[node, { hp: 2, parent }]]);
  const sibling = commands.spawn();
  commands.add(node, sibling, { parent: child });
  commands.flush();
  const owners = Array.from(world.components.getOwners(node))!;
  const byHp = new Map(owners.map((entity) => [world.components.getEntityDataOrThrow(node, entity).hp, entity]));
  const spawnedParent = byHp.get(1)!;
  const spawnedChild = byHp.get(2)!;
  assertStrictEquals(
    world.components.getEntityDataOrThrow(node, spawnedChild).parent,
    spawnedParent,
    "spawn bundle ref",
  );
  const spawnedSibling = owners.find((entity) => entity !== spawnedParent && entity !== spawnedChild)!;
  assertStrictEquals(
    world.components.getEntityDataOrThrow(node, spawnedSibling).parent,
    spawnedChild,
    "add payload ref",
  );

  const existing = world.entities.createOrThrow();
  const later = commands.spawn();
  commands.set(node, spawnedChild, { parent: later });
  commands.add(node, existing, { parent: later });
  commands.flush();
  assertStrictEquals(
    world.components.getEntityDataOrThrow(node, spawnedChild).parent,
    world.components.getEntityDataOrThrow(
      node,
      existing,
    ).parent,
    "set and add on live entities resolve the same pending ref",
  );
  assert(
    world.entities.isActive(world.components.getEntityDataOrThrow(node, existing).parent!),
    "resolved to the spawn",
  );
  await world.destroy();
});

Deno.test("command buffer writes null for pending field refs whose spawn died or failed", async () => {
  const world = await createTestWorld(components, 8);
  const commands = new CommandBuffer(world);
  const holder = world.entities.createOrThrow();
  const killed = commands.spawn();
  commands.destroy(killed);
  commands.add(node, holder, { hp: 1, parent: killed });
  commands.flush();
  assertStrictEquals(world.components.getEntityDataOrThrow(node, holder).parent, null, "spawn destroyed before use");
  assertThrows(() => commands.add(node, holder, { parent: killed }), ArgumentError, "pending");
  assertThrows(() => commands.add(node, holder, { parent: -1 as never }), ArgumentError, "pending");
  commands.spawn(); // the new epoch has a spawn at the stale handle's index; only the epoch check rejects it
  assertThrows(() => commands.add(node, holder, { parent: killed }), ArgumentError, "pending");
  commands.clear();

  while (world.entities.getAvailableCount() > 0) world.entities.createOrThrow();
  const failed = commands.spawn(); // the world is full at flush
  commands.add(node, holder, { hp: 2, parent: failed });
  assertThrows(() => commands.flush(), CapacityError, "capacity");
  assertEquals(
    world.components.getEntityDataOrThrow(node, holder),
    { hp: 2, parent: null },
    "failed spawn ref is null",
  );
  await world.destroy();
});

Deno.test("command buffers reject relation components when queuing, not at flush", async () => {
  const childOf = new Relation({ name: "childOf", exclusive: true });
  const tag = new Component({ name: "tag" });
  const components: DynamicComponent[] = [childOf, tag];
  const world = await createTestWorld(components, 16);
  const commands = new CommandBuffer(world);
  const entity = world.entities.createOrThrow();
  assertThrows(() => commands.add(childOf, entity), ArgumentError, "relation");
  assertThrows(() => commands.remove(childOf, entity), ArgumentError, "relation");
  assertThrows(() => commands.spawn([[tag], [childOf]]), ArgumentError, "relation");
  assertStrictEquals(commands.pendingCount, 0, "Nothing queued");
});

Deno.test("command buffer x relations: relation presence tags are rejected when queued, like direct calls", async () => {
  const { world, commands } = await setup();
  const a = world.entities.createOrThrow();
  assertThrows(() => commands.add(childOf, a), ArgumentError, "relation");
  commands.add(node, a, { hp: 9 });
  commands.flush();
  assert(!world.components.entityHas(childOf, a), "Relation tag not added without a pair");
  assertEquals(world.components.getEntityDataOrThrow(node, a).hp, 9, "Later commands still applied");
});
