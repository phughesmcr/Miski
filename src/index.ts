/**!
 *
 * Help make Miski even better:
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

export {
  addComponentToEntity,
  createComponent,
  registerComponent,
  removeComponentFromEntity,
  unregisterComponent,
} from "./component.js";
export { createEntity, destroyEntity } from "./entity.js";
export { createQuery } from "./query.js";
export { defineDataStore, getDataFromStore, isValidSchema, setDataInStore } from "./schema.js";
export { runPostSystems, runPreSystems, runUpdateSystems } from "./step.js";
export {
  createSystem,
  disableSystem,
  enableSystem,
  isSystemEnabled,
  registerSystem,
  unregisterSystem,
} from "./system.js";
export * from "./types.js";
export { isValidName } from "./utils.js";
export { createWorld } from "./world.js";
