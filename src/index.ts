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

export { Component } from "./component/component.js";
export { Query } from "./query/query.js";
export { System } from "./system.js";
export { World } from "./world.js";

export type { Archetype } from "./archetype/archetype.js";
export type { Bitfield } from "./bits/bitfield.js";
export type { ComponentSpec } from "./component/component.js";
export type { ComponentRecord } from "./component/manager.js";
export type { ComponentInstance } from "./component/instance.js";
export type { StorageProxy } from "./component/proxy.js";
export type { Opaque, ParametersExceptFirstTwo, TypedArray, TypedArrayConstructor } from "./utils/utils.js";
export type { QuerySpec } from "./query/query.js";
export type { QueryInstance } from "./query/instance.js";
export type { Schema, SchemaProps } from "./component/schema.js";
export type { SystemCallback, SystemSpec } from "./system.js";
export type { Entity, WorldData, WorldSpec } from "./world.js";
