import type { BooleanArray } from "@phughesmcr/booleanarray";

import type { Archetype } from "@/archetype/archetype.ts";
import type { ComponentMap, DynamicComponent, DynamicComponentInstance } from "@/types/component.ts";

/** The Query constructor specification */
export type QuerySpec = {
  /** `AND` - Gather entities as long as they have all these components */
  all?: DynamicComponent[];
  /** `OR` - When present, gather entities that have at least one of these components */
  any?: DynamicComponent[];
  /** `NOT` - Gather entities as long as they don't have these components */
  none?: DynamicComponent[];
  /** Component instances exposed to callbacks without affecting entity membership */
  include?: DynamicComponent[];
};

/** Keyed query specification used for typed query authoring. */
export type TypedQuerySpec<
  TAll extends ComponentMap = Record<never, never>,
  TAny extends ComponentMap = Record<never, never>,
  TNone extends ComponentMap = Record<never, never>,
  TInclude extends ComponentMap = Record<never, never>,
> = {
  /** Components every matching entity must have. */
  all?: TAll;
  /** Components where at least one must be present when supplied. */
  any?: TAny;
  /** Components matching entities must not have. These are filters only. */
  none?: TNone;
  /** Components exposed to callbacks without changing entity membership. */
  include?: TInclude;
};

/** Dynamic query components used when a query is authored with component arrays. */
export type UntypedQueryComponents = Record<string, DynamicComponent>;

export type QueryInstance = {
  /** A BooleanArray for the AND match criteria */
  and: BooleanArray;
  /** The archetypes which match this query */
  archetypes: Set<Archetype>;
  /** The components which match this query */
  components: Readonly<Record<string, DynamicComponentInstance>>;
  /** The QueryInstance's unique identifier */
  id: string;
  /**
   * `true` if the object is in a dirty state
   *
   * A query becomes dirty when an archetype is added or removed
   */
  isDirty: boolean;
  /** A BooleanArray for the OR match criteria */
  or: BooleanArray;
  /** A BooleanArray for the NOT match criteria */
  not: BooleanArray;
  /** A BooleanArray for non-filtering included components */
  include: BooleanArray;
};
