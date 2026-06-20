/// <reference lib="deno.ns" />

import constantsSource from "../src/constants.ts" with { type: "text" };
import archetypeSource from "../src/archetype/archetype.ts" with { type: "text" };
import { assertEquals } from "./helpers.ts";

type ForbiddenEdge = {
  source: string;
  file: string;
  importPattern: RegExp;
  reason: string;
};

const FORBIDDEN_EDGES: ForbiddenEdge[] = [
  {
    source: archetypeSource,
    file: "src/archetype/archetype.ts",
    importPattern: /@\/query\/(query|query-pool|query-manager|query-cache)\.ts/,
    reason: "archetype storage must not depend on query runtime modules",
  },
  {
    source: constantsSource,
    file: "src/constants.ts",
    importPattern: /@\/utils\.ts|\.\/utils\.ts/,
    reason: "constants must not import utils (cycle risk)",
  },
];

function importsIn(source: string): string[] {
  return [...source.matchAll(/from ["']([^"']+)["']/g)].map((match) => match[1]!);
}

Deno.test("module graph forbids known coupling edges", () => {
  const violations: string[] = [];

  for (const edge of FORBIDDEN_EDGES) {
    for (const importPath of importsIn(edge.source)) {
      if (edge.importPattern.test(importPath)) {
        violations.push(`${edge.file} imports ${importPath}: ${edge.reason}`);
      }
    }
  }

  assertEquals(violations, [], "module graph violations");
});
