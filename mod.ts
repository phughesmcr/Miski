/**
 * @module      Miski
 * @description A sweet ECS library for TypeScript.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

export { Component, isValidComponentSpec } from "./src/component/Component.ts";
export { EntityNotFoundError, MiskiError, SpecError, WorldStateError } from "./src/errors.ts";
export { isValidQuerySpec, Query } from "./src/query/Query.ts";
export { isValidSystemSpec, System } from "./src/system/System.ts";
export { isValidWorldSpec, World } from "./src/world/World.ts";
export type { ComponentInstance } from "./src/component/ComponentInstance.ts";
export type { ComponentSpec, Entity, QuerySpec, Schema, SystemSpec, WorldState } from "./src/types.ts";
