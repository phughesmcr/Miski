/**
 * @module      errors
 * @description Error classes used throughout the library.
 * @copyright   2024 the Miski authors. All rights reserved.
 * @license     MIT
 */

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

/** Creates a new error class extending MiskiError */
function createErrorClass(name: string, defaultMessage: string): typeof MiskiError {
  return class extends MiskiError {
    constructor(message?: string) {
      super(message ?? defaultMessage);
      this.name = name;
    }
  };
}

/** An error thrown when a spec object is invalid */
export const SpecError: typeof MiskiError = createErrorClass("SpecError", "Spec is invalid");

/** An error thrown when an entity is not found */
export const EntityNotFoundError: typeof MiskiError = createErrorClass("EntityNotFoundError", "Entity not found");

/** An error thrown when the world is in an invalid state */
export const WorldStateError: typeof MiskiError = createErrorClass("WorldStateError", "World is in an invalid state");

/** An error thrown when a component is not found */
export const ComponentNotFoundError: typeof MiskiError = createErrorClass(
  "ComponentNotFoundError",
  "Component not found",
);

/** An error thrown when a query returned no components */
export const NoComponentsFoundError: typeof MiskiError = createErrorClass(
  "NoComponentsFoundError",
  "Query returned no components",
);

/** An error thrown when something is not registered */
export const NotRegisteredError: typeof MiskiError = createErrorClass("NotRegisteredError", "Not registered");
