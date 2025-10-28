/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from "jsr:@std/assert";

import { Component } from "@/component/component.ts";
import { Query } from "@/query/query.ts";
import { System } from "@/system/system.ts";
import { World } from "@/world/world.ts";

Deno.test("systems: none-only query can be created and executed", async () => {
  // Arrange
  const TagA = new Component({ name: "A", schema: null });
  const TagB = new Component({ name: "B", schema: null });
  // Include at least one non-tag component to ensure non-zero storage size
  type NumSchema = { v: Float32ArrayConstructor };
  const Num = new Component<NumSchema>({ name: "N", schema: { v: Float32Array } });
  const world = new World({ capacity: 8, components: [TagA, TagB, Num] });
  await world.init();

  const e1 = world.entities.create(); // A
  const e2 = world.entities.create(); // B
  const e3 = world.entities.create(); // none
  if (e1 === undefined || e2 === undefined || e3 === undefined) throw new Error("failed to create entities");
  world.components.addToEntity(TagA, e1);
  world.components.addToEntity(TagB, e2);

  const queryNoneA = new Query({ none: [TagA] });
  const system = new System({
    name: "noneOnly",
    query: queryNoneA,
    callback: (components, entities) => {
      // components map should be empty when only `none` is specified
      assertEquals(Object.keys(components).length, 0);
      const collected: number[] = [];
      for (const id of entities) collected.push(id);
      // Expect e2 (has B) and e3 (has none), but not e1 (has A)
      collected.sort((a, b) => a - b);
      assertEquals(collected.includes(e1), false);
      assertEquals(collected.includes(e2), true);
      assertEquals(collected.includes(e3), true);
    },
  });

  // Act + Assert
  const instance = world.systems.create(system);
  await instance();
});

Deno.test("systems: duplicate name with different definition throws", async () => {
  // Arrange
  const Tag = new Component({ name: "X", schema: null });
  type NumSchema = { v: Float32ArrayConstructor };
  const Num = new Component<NumSchema>({ name: "N", schema: { v: Float32Array } });
  const world = new World({ capacity: 8, components: [Tag, Num] });
  await world.init();

  const query = new Query({ all: [Tag] });
  const sys1 = new System({
    name: "dupe",
    query,
    callback: () => {},
  });
  const sys2 = new System({
    name: "dupe", // same name, different System object (definition)
    query,
    callback: () => {},
  });

  // Act
  world.systems.create(sys1);

  // Assert
  assertThrows(
    () => {
      world.systems.create(sys2);
    },
    Error,
    "already registered with a different definition",
  );
});

Deno.test("systems: instance preserves async return type (Promise<void>) and runs", async () => {
  // Arrange
  const Tag = new Component({ name: "Y", schema: null });
  type NumSchema = { v: Float32ArrayConstructor };
  const Num = new Component<NumSchema>({ name: "N", schema: { v: Float32Array } });
  const world = new World({ capacity: 8, components: [Tag, Num] });
  await world.init();

  const e = world.entities.create();
  if (e === undefined) throw new Error("failed to create entity");
  world.components.addToEntity(Tag, e);

  const query = new Query({ all: [Tag] });
  let seen = 0;
  const sys = new System({
    name: "asyncRet",
    query,
    callback: async (_components, entities): Promise<void> => {
      for (const _ of entities) seen++;
      // simulate async work
      await Promise.resolve();
    },
  });

  // Act
  const instance = world.systems.create(sys);
  const actual = await instance();

  // Assert
  assertEquals(seen, 1);
  assertEquals(actual, undefined);
});
