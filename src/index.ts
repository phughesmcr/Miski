/**!
 * @preserve
 *
 * Help make this better:
 * https://github.com/phughesmcr/Miski
 *
 * @name         Miski
 * @file         index.js
 * @description  An Entity-Component-System (ECS) architecture.
 * @exports      createWorld()
 * @author       P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright    2021 P. Hughes. All rights reserved.
 * @license      MIT
 *
 */
"use strict";

export type { Component } from './component/component';
export type { Entity } from './entity/entity';
export type { System } from './system/system';
export type { World } from './world';

export { createWorld } from './world';
