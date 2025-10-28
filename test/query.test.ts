/// <reference lib="deno.ns" />
import { Component, Query, World } from "../mod.ts";

const Data = new Component<any>({ name: "Data", schema: { v: Float32Array } as any });

Deno.test("none-only query matches entities without forbidden component and updates on changes", async () => {
  const A = new Component({ name: "A" });
  const B = new Component({ name: "B" });
  const world = new World({ capacity: 8, components: [A, B, Data] });
  await world.init();

  const e1 = world.entities.create()!;
  if (e1 === undefined) throw new Error("Failed to create entity");

  const noneB = new Query({ none: [B] });

  // Initially, entity does not have B and should be included
  let result = [...world.entities.query(noneB)];
  if (!result.includes(e1)) throw new Error("Entity without B should be returned by none-only query");

  // Add B → entity should be excluded
  world.components.addToEntity(B, e1);
  result = [...world.entities.query(noneB)];
  if (result.includes(e1)) throw new Error("Entity with B should not be returned by none-only query");

  // Remove B → entity should be included again
  world.components.removeFromEntity(B, e1);
  result = [...world.entities.query(noneB)];
  if (!result.includes(e1)) throw new Error("Entity without B should be returned after removal by none-only query");
});

Deno.test("or-only query requires at least one component present", async () => {
  const A = new Component({ name: "A" });
  const B = new Component({ name: "B" });
  const world = new World({ capacity: 8, components: [A, B, Data] });
  await world.init();

  const e1 = world.entities.create()!;
  const anyA = new Query({ any: [A] });

  // No A yet → should be empty
  let result = [...world.entities.query(anyA)];
  if (result.includes(e1)) throw new Error("Entity without A should not be returned by OR query");

  // Add A → should include
  world.components.addToEntity(A, e1);
  result = [...world.entities.query(anyA)];
  if (!result.includes(e1)) throw new Error("Entity with A should be returned by OR query");

  // Remove A → should be empty again
  world.components.removeFromEntity(A, e1);
  result = [...world.entities.query(anyA)];
  if (result.includes(e1)) throw new Error("Entity without A should not be returned by OR query after removal");
});

Deno.test("and-only query requires all components present", async () => {
  const A = new Component({ name: "A" });
  const world = new World({ capacity: 8, components: [A, Data] });
  await world.init();

  const e1 = world.entities.create()!;
  const allA = new Query({ all: [A] });

  // No A yet → should be empty
  let result = [...world.entities.query(allA)];
  if (result.includes(e1)) throw new Error("Entity without A should not be returned by AND query");

  // Add A → should include
  world.components.addToEntity(A, e1);
  result = [...world.entities.query(allA)];
  if (!result.includes(e1)) throw new Error("Entity with A should be returned by AND query");
});

Deno.test("components query returns expected component instances", async () => {
  const A = new Component({ name: "A" });
  const B = new Component({ name: "B" });
  const world = new World({ capacity: 8, components: [A, B, Data] });
  await world.init();

  const allA = new Query({ all: [A] });
  const anyAB = new Query({ any: [A, B] });

  const compsAllA = world.components.query(allA);
  if (!("A" in compsAllA)) throw new Error("components.query(all:[A]) should include A");

  const compsAnyAB = world.components.query(anyAB);
  if (!("A" in compsAnyAB) || !("B" in compsAnyAB)) {
    throw new Error("components.query(any:[A,B]) should include A and B");
  }
});
