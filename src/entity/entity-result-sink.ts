/**
 * @module      entity-result-sink
 * @description Interface for dense entity result collection.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { Entity } from "@/entity/entity-id.ts";

/** Mutable sink that accepts dense entity IDs during query materialization. */
export type EntityResultSink = {
  add(entity: Entity): void;
};
