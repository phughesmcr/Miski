/**
 * @module      types/system-bindings
 * @description Internal bindings used when constructing system instances.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { Query } from "@/query/query.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { BorrowedEntityList } from "@/types/entity-views.ts";

/** Internal world bindings used while constructing a system instance. */
export type SystemBindings = {
  queryComponents(query: Query): Record<string, DynamicComponentInstance>;
  queryEntityList(query: Query): BorrowedEntityList;
};
