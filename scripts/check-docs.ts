/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-top-level-await

/**
 * Type-check the JSDoc examples in mod.ts (`deno check --doc`).
 *
 * Deno auto-imports every export of the module into each example, so the project's `noUnusedLocals` and
 * `noUnusedParameters` compiler options would flag every example. This script runs the doc check against a
 * temporary copy of deno.json with only those two options disabled; everything else (strictness, import map,
 * lockfile) is identical to the real config.
 */
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(await Deno.readTextFile(join(root, "deno.json")));

const imports: Record<string, string> = {};
for (const [key, value] of Object.entries<string>(config.imports ?? {})) {
  imports[key] = value.startsWith(".") ? new URL(value, new URL("file://" + root)).href : value;
}
const docConfig = {
  compilerOptions: { ...config.compilerOptions, noUnusedLocals: false, noUnusedParameters: false },
  imports,
};

const temporary = await Deno.makeTempDir({ prefix: "miski-doc-check-" });
try {
  const configPath = join(temporary, "deno.json");
  await Deno.writeTextFile(configPath, JSON.stringify(docConfig));
  const signal = AbortSignal.timeout(5 * 60_000);
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["check", "--doc", "--config", configPath, "--no-lock", "mod.ts"],
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    signal,
  }).output();
  if (!result.success) Deno.exit(result.code || 1);
} finally {
  await Deno.remove(temporary, { recursive: true });
}
