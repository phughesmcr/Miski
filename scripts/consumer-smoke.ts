/// <reference lib="deno.ns" />
// This is a CLI script: it reports progress on stdout, runs sequential steps, and is the program entry point.
// deno-lint-ignore-file no-console no-top-level-await no-await-in-loop

import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const playwrightModule = Deno.env.get("MISKI_PLAYWRIGHT_MODULE");
if (!playwrightModule) throw new Error("Set MISKI_PLAYWRIGHT_MODULE to an installed Playwright module (index.mjs).");

const MINUTE = 60_000;
// Per-subprocess ceilings; a hung registry fetch or browser launch must fail the job rather than stall it.
const TIMEOUT = {
  /** `node|npm|bun --version`, `deno info/check/bundle/pack`. */
  default: 5 * MINUTE,
  /** `npm install` / `bun add` of the packed tarball (network bound). */
  install: 10 * MINUTE,
  /** Running the consumer smoke fixture under node / bun. */
  runtime: 2 * MINUTE,
  /** Launching Playwright's Chromium and running the browser fixture. */
  browser: 5 * MINUTE,
} as const;

async function run(command: string, args: string[], cwd = root, timeoutMs: number = TIMEOUT.default): Promise<string> {
  const label = `${command} ${args.join(" ")}`;
  let result: Deno.CommandOutput;
  try {
    result = await new Deno.Command(command, {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(timeoutMs),
    }).output();
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s and was terminated.`);
    }
    throw error;
  }
  const output = new TextDecoder().decode(result.stdout);
  if (!result.success) {
    throw new Error(`${label} failed (${result.code}):\n${output}${new TextDecoder().decode(result.stderr)}`);
  }
  return output;
}

type Resolution = {
  specifier: string;
};
type Module = {
  specifier: string;
  local?: string;
  dependencies?: { specifier: string; code?: Resolution; type?: Resolution }[];
};

for (const runtime of ["node", "npm", "bun"]) {
  const version = (await run(runtime, ["--version"])).trim();
  if (!version) throw new Error(`${runtime} --version returned no output; check the executable on PATH.`);
  console.log(`${runtime}: ${version}`);
}

const temporary = await Deno.makeTempDir({ prefix: "miski-consumers-" });
try {
  const config = JSON.parse(await Deno.readTextFile(join(root, "deno.json")));
  const successMarker = `MISKI_CONSUMER_SMOKE_OK ${config.version}`;
  const sourceRoot = join(temporary, "source");
  await Deno.mkdir(sourceRoot);
  const graph: { modules: Module[] } = JSON.parse(await run(Deno.execPath(), ["info", "--json", "--frozen", "mod.ts"]));

  // ponytail: Deno 2.9 pack leaves import-map aliases unresolved; remove this temp rewrite once pack preserves them.
  for (const module of graph.modules) {
    if (!module.specifier.startsWith("file:") || !module.local) continue;
    let source = await Deno.readTextFile(module.local);
    for (const dependency of module.dependencies ?? []) {
      if (config.imports[dependency.specifier] === undefined && !dependency.specifier.startsWith("@/")) continue;
      const resolution = dependency.code ?? dependency.type;
      if (!resolution) continue;
      let specifier = resolution.specifier;
      if (specifier.startsWith("file:")) {
        specifier = relative(dirname(module.local), fileURLToPath(specifier)).replaceAll("\\", "/");
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
      }
      source = source.replaceAll(JSON.stringify(dependency.specifier), JSON.stringify(specifier))
        .replaceAll(`'${dependency.specifier}'`, JSON.stringify(specifier));
    }
    const target = join(sourceRoot, relative(root, module.local));
    await Deno.mkdir(dirname(target), { recursive: true });
    await Deno.writeTextFile(target, source);
  }
  for (const file of ["README.md", "LICENSE"]) await Deno.copyFile(join(root, file), join(sourceRoot, file));
  await Deno.writeTextFile(join(sourceRoot, "deno.json"), JSON.stringify({ ...config, imports: {}, lock: false }));
  const tarball = join(temporary, "miski.tgz");
  await run(Deno.execPath(), ["pack", "--allow-dirty", "--config", "deno.json", "--output", tarball], sourceRoot);

  const fixture = await Deno.readTextFile(join(root, "test/consumer-fixture.mjs"));
  const runner = `import * as miski from ${JSON.stringify(config.name)};
import { runConsumerSmoke } from "./consumer-fixture.mjs";
await runConsumerSmoke(miski, ${JSON.stringify(config.version)});
console.log(${JSON.stringify(successMarker)});
`;
  const types = `import { createEcsWorld, type Entity, entityIndex } from ${JSON.stringify(config.name)};
const game = createEcsWorld({ capacity: 8, components: { Position: { x: Float32Array } } });
const entity: Entity = game.spawnOrThrow({ Position: { x: 1 } });
const column: Float32Array = game.storage.Position.storage.partitions.x;
Array.from(game.world.entities.getActive(entityIndex(entity)));
// @ts-expect-error Unknown component fields must remain rejected by the packed declarations.
game.spawn({ Position: { missing: 1 } });
// @ts-expect-error Packed handles must not be accepted as raw slot bounds.
game.world.entities.getActive(entity);
void column;
`;
  for (const runtime of ["node", "bun"]) {
    const project = join(temporary, runtime);
    await Deno.mkdir(project);
    await Deno.writeTextFile(join(project, "package.json"), JSON.stringify({ private: true, type: "module" }));
    await Deno.writeTextFile(join(project, ".npmrc"), "@jsr:registry=https://npm.jsr.io\n");
    await Deno.writeTextFile(join(project, "consumer-fixture.mjs"), fixture);
    await Deno.writeTextFile(join(project, "smoke.mjs"), runner);
    await Deno.writeTextFile(join(project, "types.ts"), types);
    await run(
      runtime === "node" ? "npm" : "bun",
      runtime === "node" ?
        ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball] :
        ["add", "--ignore-scripts", tarball],
      project,
      TIMEOUT.install,
    );
    const output = await run(runtime, ["smoke.mjs"], project, TIMEOUT.runtime);
    if (output.trim() !== successMarker) throw new Error(`${runtime} did not report successful gameplay: ${output}`);
    await run(Deno.execPath(), ["check", "--no-config", "--node-modules-dir=manual", "types.ts"], project);
    console.log(`${runtime} clean-install runtime and declaration checks passed (${config.version}).`);
  }

  const bundlePath = join(temporary, "miski.js");
  await run(Deno.execPath(), [
    "bundle",
    "--platform=browser",
    "--format=esm",
    "--minify",
    "--output",
    bundlePath,
    "mod.ts",
  ]);
  const bundle = await Deno.readTextFile(bundlePath);
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/miski.js" || path === "/consumer-fixture.mjs") {
      return new Response(path === "/miski.js" ? bundle : fixture, { headers: { "content-type": "text/javascript" } });
    }
    return new Response("<!doctype html><title>Miski consumer smoke</title>", {
      headers: { "content-type": "text/html" },
    });
  });
  try {
    const browserRunner = join(temporary, "browser-smoke.mjs");
    await Deno.writeTextFile(
      browserRunner,
      `import { chromium } from ${JSON.stringify(pathToFileURL(playwrightModule).href)};
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.argv[2]);
  await page.evaluate(async (version) => {
    const miski = await import("/miski.js");
    const { runConsumerSmoke } = await import("/consumer-fixture.mjs");
    await runConsumerSmoke(miski, version);
  }, process.argv[3]);
  if (errors.length) throw new Error(errors.join("\\n"));
  console.log(${JSON.stringify(successMarker)});
} finally {
  await browser.close();
}
`,
    );
    const output = await run(
      "node",
      [browserRunner, `http://127.0.0.1:${server.addr.port}`, config.version],
      temporary,
      TIMEOUT.browser,
    );
    if (output.trim() !== successMarker) throw new Error(`Chromium did not report successful gameplay: ${output}`);
    console.log(`Chromium browser bundle gameplay check passed (${config.version}).`);
  } finally {
    await server.shutdown();
  }
} finally {
  await Deno.remove(temporary, { recursive: true });
}
