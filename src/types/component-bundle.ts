import type { Component } from "@/component/component.ts";
import type { DynamicComponent } from "@/types/component.ts";
import type { SchemaValues } from "@/types/partitions.ts";

/** Runtime-compatible component bundle tuple. */
export type ComponentBundleEntryInput =
  | readonly [DynamicComponent]
  | readonly [DynamicComponent, Partial<Record<string, number>>];

/** A bundle tuple checked against one concrete component definition. */
export type ComponentBundleEntryFor<TComponent extends DynamicComponent> = TComponent extends
  Component<infer TValue, infer TStorage> ? TStorage extends null ? readonly [TComponent] :
  readonly [TComponent] | readonly [TComponent, Partial<SchemaValues<TValue>>] :
  never;

/** A component bundle whose entries are checked component-by-component. */
export type ComponentBundle<TBundle extends readonly ComponentBundleEntryInput[]> = {
  readonly [I in keyof TBundle]: TBundle[I] extends readonly [infer TComponent extends DynamicComponent] ?
    ComponentBundleEntryFor<TComponent> :
    TBundle[I] extends readonly [infer TComponent extends DynamicComponent, unknown] ?
      ComponentBundleEntryFor<TComponent> :
    never;
};
