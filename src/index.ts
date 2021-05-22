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

export type { Component, ComponentSpec } from './component/component';
export type { Entity } from './entity/entity';
export type { Poolable } from './pool/pool';
export type { Query, QuerySpec } from './query/query';
export type { System, SystemSpec } from './system/system';
export type { Toggleable } from './utils';
export type { World, WorldSpec } from './world';

export { createWorld } from './world';
