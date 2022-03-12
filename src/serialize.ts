/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

interface SerializationManagerSpec {
  getBuffer: () => ArrayBuffer;
  setBuffer: (source: ArrayBuffer) => ArrayBuffer;
  version: string;
}

export interface MiskiData {
  componentBuffer: ArrayBuffer;
  version: string;
}

export interface SerializationManager {
  load: (data: MiskiData) => boolean;
  save: () => MiskiData;
}

export function createSerializationManager(spec: SerializationManagerSpec): SerializationManager {
  const { getBuffer, setBuffer, version } = spec;

  function save(): Readonly<MiskiData> {
    return Object.freeze({
      componentBuffer: getBuffer(),
      version,
    });
  }

  function load(data: MiskiData): boolean {
    const { componentBuffer } = data;
    /** @todo validate! */
    if (!version.match(data.version)) {
      console.warn(`Miski version mismatch: Expected ${version}, found ${data.version}.`);
    }
    setBuffer(componentBuffer);
    return true;
  }

  return {
    load,
    save,
  };
}
