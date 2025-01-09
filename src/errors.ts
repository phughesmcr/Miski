/**
 * @module      errors
 * @description Error classes used throughout the library.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

import type { Entity } from "./types.ts";

/** The base error class for all Miski errors */
export class MiskiError extends Error {
  constructor(message?: string) {
    super(message);
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

/** An error thrown when a spec object is invalid */
export class SpecError extends MiskiError {
  constructor(message?: string) {
    super(message ?? "Spec is invalid");
    this.name = "SpecError";
  }
}

/** An error thrown when an entity is not found */
export class EntityNotFoundError extends MiskiError {
  constructor(entity: Entity) {
    super(`Entity ${entity} not found`);
    this.name = "EntityNotFoundError";
  }
}

/** An error thrown when the world is in an invalid state */
export class WorldStateError extends MiskiError {
  constructor(message?: string) {
    super(message ?? "World is in an invalid state");
    this.name = "WorldStateError";
  }
}

/** An error thrown when a component is not found */
export class ComponentNotFoundError extends MiskiError {
  constructor(message?: string) {
    super(message ?? "Component not found");
    this.name = "ComponentNotFoundError";
  }
}

/** An error thrown when a query returned no components */
export class NoComponentsFoundError extends MiskiError {
  constructor(message?: string) {
    super(message ?? "Query returned no components");
    this.name = "NoComponentsFoundError";
  }
}

/** An error thrown when something is not registered */
export class NotRegisteredError extends MiskiError {
  constructor(message: string) {
    super(message);
    this.name = "NotRegisteredError";
  }
}
