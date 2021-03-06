/**!
 *
 * Help make this better:
 * https://github.com/phughesmcr/Miski
 *
 * @name         Miski
 * @file         index.js
 * @description  An Entity-Component-System (ECS) architecture in Typescript.
 * @author       P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright    2021 P. Hughes. All rights reserved.
 * @license      MIT
 *
 */
"use strict";

export type { ComponentSpec } from "./component/component";
export type { Entity } from "./entity/entity-manager";
export type { Poolable } from "./pool/pool";
export type { Query, QuerySpec } from "./query/query";
export type { System, SystemSpec } from "./system/system";
export type { World, WorldSpec } from "./world";

export { createComponent } from "./component/component";
export { createWorld } from "./world";
export { Types } from "./component/schema";
