/// <reference lib="deno.ns" />

import config from "../deno.json" with { type: "json" };
import { World } from "../mod.ts";
import { assertEquals } from "./helpers.ts";

Deno.test("public runtime version matches the published package version", () => {
  assertEquals(World.version, config.version, "Release metadata and runtime must identify the same version");
});

const INSTALL_COMMANDS = [
  "npx jsr add @phughesmcr/miski@",
  "deno add jsr:@phughesmcr/miski@",
  "bunx jsr add @phughesmcr/miski@",
] as const;

Deno.test("README install snippets pin the current package version", async () => {
  const readme = await Deno.readTextFile(new URL("../README.md", import.meta.url));
  for (const command of INSTALL_COMMANDS) {
    const match = readme.match(new RegExp(`${command.replaceAll(".", "\\.")}(\\S+)`));
    assertEquals(
      match?.[1],
      config.version,
      `README "${command}" snippet must use deno.json version ${config.version}`,
    );
  }
});

Deno.test("CHANGELOG documents the current package version", async () => {
  const changelog = await Deno.readTextFile(new URL("../CHANGELOG.md", import.meta.url));
  const heading = new RegExp(`^## \\[?${config.version.replaceAll(".", "\\.")}\\]?(\\s|$)`, "m");
  assertEquals(heading.test(changelog), true, `CHANGELOG.md needs a "## ${config.version}" section`);
});
