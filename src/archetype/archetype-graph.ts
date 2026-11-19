import { BooleanArray } from "@phughesmcr/booleanarray";

import type { EntityArray, PackSlot } from "@/entity/entity.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import { Archetype, type ArchetypeClock } from "./archetype.ts";

/**
 * A world's archetype registry and the transition-edge graph between its archetypes.
 *
 * Archetypes are kept in creation order (their {@link Archetype.registryIndex}), and each caches the
 * archetype reached by adding or removing one component, so warm transitions skip the bitfield probe.
 */
export class ArchetypeGraph {
  /** Archetypes by their id. */
  readonly registry: Map<string, Archetype> = new Map();

  /** The archetype of entities that have no components. */
  readonly root: Archetype;

  /** Dense archetype list in registry order; only the first {@link count} entries are valid. */
  readonly #archetypes: Archetype[] = [];

  /** Valid prefix length of {@link #archetypes}. */
  #count: number = 0;

  readonly #capacity: number;
  readonly #componentCount: number;
  readonly #packSlot: PackSlot;
  readonly #positions: EntityArray;
  readonly #clock: ArchetypeClock;

  /**
   * @param capacity - The world's entity capacity
   * @param componentCount - Number of components registered in the world (transition edge array size)
   * @param packSlot - Packs a live slot into an entity handle
   * @param positions - Slot-to-position table shared by the world's archetypes
   * @param clock - The world's structural change clock
   */
  constructor(
    capacity: number,
    componentCount: number,
    packSlot: PackSlot,
    positions: EntityArray,
    clock: ArchetypeClock,
  ) {
    this.#capacity = capacity;
    this.#componentCount = componentCount;
    this.#packSlot = packSlot;
    this.#positions = positions;
    this.#clock = clock;
    this.root = this.#create([], new BooleanArray(componentCount));
  }

  /** Number of registered archetypes. */
  get count(): number {
    return this.#count;
  }

  /** The archetype at a registry index below {@link count}. */
  at(index: number): Archetype {
    return this.#archetypes[index]!;
  }

  /** Whether `archetype` is registered here (and not, say, in another world). */
  holds(archetype: Archetype): boolean {
    const index = archetype.registryIndex;
    return index >= 0 && index < this.#count && this.#archetypes[index] === archetype;
  }

  /**
   * Get or create the archetype reached by adding or removing one component.
   * @param from - The source archetype
   * @param instance - The component being added or removed
   * @param add - Whether the component is being added
   * @returns The target archetype (`from` itself when it already has, or lacks, the component)
   */
  transition(from: Archetype, instance: DynamicComponentInstance, add: boolean): Archetype {
    // Warm transitions skip the bitfield probe (hot add/remove path).
    const transitions = add ? from.addTransitions : from.removeTransitions;
    const cached = transitions[instance.id];
    if (cached) return cached;

    const hasComponent = from.bitfield.get(instance.id);
    if (hasComponent === add) {
      transitions[instance.id] = from;
      return from;
    }

    const bitfield = from.bitfield.clone();
    bitfield.set(instance.id, add);
    let archetype = this.registry.get(bitfield.buffer.toString());
    if (!archetype) {
      const components = add ?
        componentsWithAdded(from.components, instance) :
        componentsWithRemoved(from.components, instance);
      archetype = this.#create(components, bitfield);
    }

    transitions[instance.id] = archetype;
    return archetype;
  }

  /**
   * Get or create the archetype reached by adding a set of components.
   * Walks warm single-component edges so hot bundle spawns avoid bitfield clone/toString.
   * @param from - The source archetype
   * @param instances - Components being added
   * @param count - Active prefix length of `instances`
   * @returns The target archetype
   */
  transitionAddingSet(from: Archetype, instances: readonly DynamicComponentInstance[], count: number): Archetype {
    let current = from;
    for (let i = 0; i < count; i++) current = this.transition(current, instances[i]!, true);
    return current;
  }

  /**
   * Register a new archetype for the components set in a saved bitset.
   * @param instances - Component instances by instance id
   * @param bits - Saved component bitsets
   * @param offset - First word of this archetype's bitset in `bits`
   * @returns The new archetype
   */
  createFromBits(instances: readonly DynamicComponentInstance[], bits: Uint32Array, offset: number): Archetype {
    const componentCount = this.#componentCount;
    const bitfield = new BooleanArray(componentCount);
    const components: DynamicComponentInstance[] = [];
    for (let id = 0; id < componentCount; id++) {
      if (((bits[offset + (id >>> 5)]! >>> (id & 31)) & 1) === 0) continue;
      bitfield.set(id, true);
      components.push(instances[id]!);
    }
    return this.#create(components, bitfield);
  }

  /**
   * Number of leading registered archetypes whose component sets equal the saved ones.
   * @param bits - Component bitsets of the saved archetypes, `wordsPerSet` words each, in registry order
   * @param wordsPerSet - Words per bitset
   * @param count - Number of saved archetypes
   */
  savedPrefix(bits: Uint32Array, wordsPerSet: number, count: number): number {
    const limit = Math.min(count, this.#count);
    let keep = 0;
    while (keep < limit && sameWords(this.#archetypes[keep]!.bitfield.buffer, bits, keep * wordsPerSet, wordsPerSet)) {
      keep++;
    }
    return keep;
  }

  /** Drop archetypes registered at index `keep` and later, with the cached edges that lead to them. */
  truncate(keep: number): void {
    if (keep >= this.#count) return;
    for (let i = keep; i < this.#count; i++) {
      this.registry.delete(this.#archetypes[i]!.id);
      this.#archetypes[i] = undefined as unknown as Archetype;
    }
    for (let i = 0; i < keep; i++) {
      const archetype = this.#archetypes[i]!;
      pruneEdges(archetype.addTransitions, keep);
      pruneEdges(archetype.removeTransitions, keep);
    }
    this.#count = keep;
  }

  /** Forget every archetype (world teardown). */
  clear(): void {
    this.registry.clear();
    this.#count = 0;
  }

  /** Create an archetype and register it at the end of the registry. */
  #create(components: DynamicComponentInstance[], bitfield: BooleanArray): Archetype {
    const archetype = new Archetype(
      this.#capacity,
      components,
      bitfield,
      this.#packSlot,
      this.#componentCount,
      this.#positions,
      this.#clock,
    );
    archetype.registryIndex = this.#count;
    this.registry.set(archetype.id, archetype);
    this.#archetypes[this.#count++] = archetype;
    return archetype;
  }
}

/** A component list with one component inserted in registry-id order. */
function componentsWithAdded(
  components: readonly DynamicComponentInstance[],
  instance: DynamicComponentInstance,
): DynamicComponentInstance[] {
  const result = new Array<DynamicComponentInstance>(components.length + 1);
  let out = 0;
  let inserted = false;
  for (let i = 0; i < components.length; i++) {
    const component = components[i]!;
    if (!inserted && instance.id < component.id) {
      result[out++] = instance;
      inserted = true;
    }
    result[out++] = component;
  }
  if (!inserted) result[out] = instance;
  return result;
}

/** A component list with one component removed. */
function componentsWithRemoved(
  components: readonly DynamicComponentInstance[],
  instance: DynamicComponentInstance,
): DynamicComponentInstance[] {
  const result = new Array<DynamicComponentInstance>(Math.max(components.length - 1, 0));
  let out = 0;
  for (let i = 0; i < components.length; i++) {
    const component = components[i]!;
    if (component.id === instance.id) continue;
    result[out++] = component;
  }
  return result;
}

/** Whether a bitfield's words equal `length` words of `bits` starting at `offset`. */
function sameWords(words: Uint32Array, bits: Uint32Array, offset: number, length: number): boolean {
  if (words.length !== length) return false;
  for (let i = 0; i < length; i++) if (words[i] !== bits[offset + i]) return false;
  return true;
}

/** Forget cached transition edges that lead to archetypes dropped by a rollback. */
function pruneEdges(edges: Archetype[], keep: number): void {
  for (let i = 0; i < edges.length; i++) {
    const target = edges[i];
    if (target !== undefined && target.registryIndex >= keep) edges[i] = undefined as unknown as Archetype;
  }
}
