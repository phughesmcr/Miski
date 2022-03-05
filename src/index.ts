/**!
 *
 * 🍬
 * Help make Miski even better:
 * https://github.com/phughesmcr/Miski
 *
 * @name         Miski
 * @file         index.js
 * @description  An Entity-Component-System (ECS) architecture in Typescript.
 * @author       P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright    2022 the Miski authors. All rights reserved.
 * @license      MIT
 *
 */

export { createComponent } from "./component/component.js";
export { createQuery } from "./query/query.js";
export { createSystem } from "./system.js";
export { createWorld } from "./world.js";

export type { Archetype } from "./archetype/archetype.js";
export type { Bitfield } from "./bitfield.js";
export type { Component, ComponentRecord, ComponentSpec } from "./component/component.js";
export type { ComponentInstance } from "./component/instance.js";
export type { Entity } from "./entity.js";
export type { MiskiData } from "./serialize.js";
export type { Opaque, ParametersExceptFirst, TypedArrayConstructor } from "./utils.js";
export type { Query, QuerySpec } from "./query/query.js";
export type { QueryInstance } from "./query/instance.js";
export type { Schema, SchemaProps } from "./component/schema.js";
export type { System } from "./system.js";
export type { World, WorldSpec } from "./world.js";
