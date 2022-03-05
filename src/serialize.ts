/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

interface SerializationManagerSpec {
  getBuffer: () => ArrayBuffer;
  setBuffer: (source: ArrayBuffer) => ArrayBuffer;
}

export interface MiskiData {
  componentBuffer: ArrayBuffer;
}

export interface SerializationManager {
  load: (data: MiskiData) => boolean;
  save: () => MiskiData;
}

export function createSerializationManager(spec: SerializationManagerSpec): SerializationManager {
  const { getBuffer, setBuffer } = spec;

  function save(): Readonly<MiskiData> {
    return Object.freeze({
      componentBuffer: getBuffer(),
    });
  }

  function load(data: MiskiData): boolean {
    const { componentBuffer } = data;
    /** @todo validate! */
    setBuffer(componentBuffer);
    return true;
  }

  return {
    load,
    save,
  };
}
