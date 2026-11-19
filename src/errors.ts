import type { Entity } from "@/entity/entity.ts";

/** Resolve a component reference to its display name */
export function componentDisplayName(component: { readonly name: string } | string): string {
  return typeof component === "string" ? component : component.name;
}

/** Format a not-registered component error message */
export function formatComponentNotRegistered(name: string): string {
  return `Component "${name}" is not registered in this world.`;
}

/** Format a not-registered system error message */
export function formatSystemNotRegistered(name: string): string {
  return `System "${name}" is not registered in this world.`;
}

/** Format an inactive-entity error message */
export function formatEntityNotActive(entity: Entity): string {
  return `Entity ${entity} is not active.`;
}

/** Format an out-of-range entity error message */
export function formatEntityOutOfRange(entity: Entity): string {
  return `Entity ${entity} is out of range.`;
}

/** The base error class for all Miski errors */
export class MiskiError extends Error {
  /**
   * Create a Miski error.
   * @param message - Optional human-readable error message.
   * @param options - Optional standard error options, such as the underlying `cause`.
   */
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MiskiError";
  }
}

/**
 * Checks if an error is a MiskiError
 * @param error The error to check
 * @returns Whether the error is a MiskiError
 */
export function isMiskiError(error: unknown): error is MiskiError {
  return error instanceof MiskiError;
}

/** Creates a new error class extending MiskiError */
function createErrorClass(name: string, defaultMessage: string): typeof MiskiError {
  return class extends MiskiError {
    constructor(message?: string, options?: ErrorOptions) {
      super(message ?? defaultMessage, options);
      this.name = name;
    }
  };
}

/** An error thrown when a spec object is invalid */
export const SpecError: typeof MiskiError = createErrorClass("SpecError", "Spec is invalid");

/** An error thrown when an entity is not found */
export const EntityNotFoundError: typeof MiskiError = createErrorClass("EntityNotFoundError", "Entity not found");

/** An error thrown when a name is already registered */
export const AlreadyRegisteredError: typeof MiskiError = createErrorClass(
  "AlreadyRegisteredError",
  "Already registered",
);

/** An error thrown when the world is in an invalid state */
export const WorldStateError: typeof MiskiError = createErrorClass("WorldStateError", "World is in an invalid state");

/** An error thrown when an entity does not own the requested component or relation pair */
export const ComponentOwnershipError: typeof MiskiError = createErrorClass(
  "ComponentOwnershipError",
  "Entity does not own component",
);

/** An error thrown when component or relation data is invalid, or a component has no data storage */
export const ComponentDataError: typeof MiskiError = createErrorClass(
  "ComponentDataError",
  "Component has no data storage",
);

/** An error thrown when something is not registered */
export const NotRegisteredError: typeof MiskiError = createErrorClass("NotRegisteredError", "Not registered");

/** An error thrown when the world's entity capacity, or a component's `maxEntities` owner cap, is exhausted */
export const CapacityError: typeof MiskiError = createErrorClass("CapacityError", "World is at capacity");

/** An error thrown when a call argument is malformed, such as a bundle, a batch list, a delta time or a handle */
export const ArgumentError: typeof MiskiError = createErrorClass("ArgumentError", "Invalid argument");

/** An error thrown when adding a pair to an acyclic relation would form a cycle */
export const RelationCycleError: typeof MiskiError = createErrorClass(
  "RelationCycleError",
  "Relation pair would form a cycle",
);

/** Build the {@link CapacityError} for a component whose `maxEntities` owner cap would be exceeded */
export function maxOwnersError(componentName: string, maxEntities: number): MiskiError {
  return new CapacityError(`Component "${componentName}" can only be added to ${maxEntities} entities.`);
}
