/// <reference lib="deno.worker" />

/**
 * Worker for `float16_column.test.ts`: removes `Float16Array`, then imports Miski in this worker's fresh module graph,
 * as a runtime without it (older browsers, Electron and Node builds) would. Receives an f16 save made by the parent
 * and posts back what happened.
 */

export type NoFloat16Report = {
  /** The import error, if the import failed. */
  importError?: string;
  /** f32 value read back after a binary save -> load round-trip. */
  roundTrip?: number;
  /** Whether `Float16Array` is still absent after the import (Miski must not polyfill it). */
  stillAbsent?: boolean;
  /** `name: message` of the error from loading the parent's f16 save. */
  f16LoadError?: string;
  /** `name: message` of the error from turning the parent's f16 save into a document. */
  f16DocumentError?: string;
};

function errorText(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
}

self.onmessage = async (event: MessageEvent<{ f16Save: Uint8Array }>) => {
  delete (globalThis as { Float16Array?: unknown }).Float16Array;
  const report: NoFloat16Report = {};
  try {
    const { Component, loadWorld, saveWorld, World, worldSaveToDocument } = await import("../mod.ts");
    const full = new Component({ name: "full", schema: { v: Float32Array } });
    const make = async () => {
      const world = new World({ capacity: 16, components: [full] });
      await world.init();
      return world;
    };
    const source = await make();
    const e = source.entities.createOrThrow();
    source.components.addToEntity(full, e, { v: 1.5 });
    const target = await make();
    loadWorld(target, saveWorld(source));
    report.roundTrip = (target.components.getEntityDataOrThrow(full, e) as { v: number }).v;
    report.stillAbsent = typeof (globalThis as { Float16Array?: unknown }).Float16Array === "undefined";
    report.f16LoadError = errorText(() => loadWorld(target, event.data.f16Save));
    report.f16DocumentError = errorText(() => worldSaveToDocument(event.data.f16Save));
  } catch (error) {
    report.importError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  self.postMessage(report);
  self.close();
};
