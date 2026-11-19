# Contributing to Miski

We love your input! We want to make contributing to this project as easy and
transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## We Develop with GitHub

We use GitHub to host code, to track issues and feature requests, as well as
accept pull requests.

## Any contributions you make will be under the MIT Software License

When you submit code changes, your submissions are understood to be under the
same [MIT License](http://choosealicense.com/licenses/mit/) that covers the
project. Feel free to contact the maintainers if that's a concern.

## Report bugs using GitHub's issues

We use GitHub issues to track public bugs. Report a bug by
[opening a new issue](https://github.com/phughesmcr/miski/issues).

## Write bug reports with detail, background, and sample code

Try to include:

- A quick summary and/or background
- Steps to reproduce
  - Be specific
  - Give sample code if you can
- What you expected would happen
- What actually happens
- Notes (possibly including why you think this might be happening, or stuff you
  tried that didn't work)

## Use a Consistent Coding Style

Please run `deno task ci` and fix any formatting, linting, type-checking, test,
or publish validation errors before submitting pull requests.

Prefer prototype methods for class behavior. Use arrow functions for small
public facade wrappers, callbacks, or other cases that intentionally need
lexical `this`.

Inside `src`, use `@/` imports for cross-folder modules and `./` imports for
same-folder modules. Keep external package imports first, then a blank line,
then internal imports.

## Architecture

Public entry points:

- [`mod.ts`](mod.ts) — package exports and JSR module docs
- [`src/types/world-api.ts`](src/types/world-api.ts) — `World*API` contracts consumers see on `world.entities` / `world.components` / etc.

Mutation pipeline (keep these boundaries when changing code):

1. **World** validates and orchestrates (liveness, preflight, query invalidation)
2. **ComponentManager** owns storage, ownership flags, and changed tracking
3. **ArchetypeManager** owns archetype membership and transitions

Borrowed vs snapshot iterators:

- Hot paths return **borrowed** dense views (`queryList`, `getChanged`, `getOwners`) that are valid only until the next world mutation or `refresh`
- `query` and `getActive` return a pooled iterator per call, so nested loops are independent; it returns to its pool when the loop ends or breaks. `getActive` copies its handles; `query` reads the query's retained result, which re-querying after a mutation refills
- `*Snapshot` / `querySnapshot` / `toArray` helpers allocate stable copies for tools, tests, and non-frame-critical code

Layout sketch: `src/{archetype,checkpoint,component,entity,prefab,query,relation,rollback,scheduler,schema,serialization,system,types,value,world}/`. Demos live in `example/`; throughput and GC budgets in `bench/`. See [`test/README.md`](test/README.md) for how tests map to API domains.

Validation: `deno task ci` before every PR (includes the retained-memory and GC allocation gates). For performance-sensitive changes also run `deno task bench` and ideally `deno task bench:all` (throughput + retained memory).

CI and tag publishing also run `deno task smoke:consumers`: clean Node 24 and
Bun 1.3 package installs, consumer declaration checks, and a Chromium browser
bundle. This requires Node/npm/Bun and an external Playwright installation.
Set `MISKI_PLAYWRIGHT_MODULE` to Playwright's `index.mjs` path and install its
Chromium binary first. The workflow installs browser tooling under
`$RUNNER_TEMP`; no browser tooling ships with Miski. Use Deno 2.9.7 for local
release validation to match CI.

## Naming and comments

- Use `instance.storage.partitions` for raw SoA access in docs and examples (there is no `.partitions` alias)
- Prefer `entityIndex` / `queryList` `slots` for SoA writes; packed `entities` handles for identity APIs (`isActive`, ownership). Do not index partitions with a packed handle — brands catch swaps at function APIs only; `TypedArray` indexing still accepts either number.
- Document the layered query pattern (`query` / `queryList` / `querySnapshot`) rather than renaming methods
- Comment *why* on preflight, atomicity, and borrowed lifetimes; avoid comments that only restate the identifier
- ASCII-only in `src/` comments (`prefer-ascii` lint)

## Releasing

JSR publishing is triggered by version tags (`v*`), not by merging to `master`.

1. Update `"version"` in `deno.json`, `VERSION` in `src/constants.ts`,
   `CHANGELOG.md` (add a `## <version>` section), and the install snippets in
   `README.md`. The release integrity test checks that the runtime version,
   `deno.json`, the README install commands, and the changelog all agree.
2. CI, including consumer smoke checks, must pass.
   - **Stable releases** (no `-` in the version, e.g. `1.0.0`): merge to
     `master` first. The Publish workflow refuses to run unless the tagged
     commit is an ancestor of `origin/master`.
   - **Pre-releases** (version contains `-`, e.g. `1.0.0-beta.2`): may be tagged
     from any branch, such as `1.0.0-alpha`; master ancestry is not required.
3. Create and push a matching tag:

   ```sh
   git tag v1.0.0-beta.2
   git push origin v1.0.0-beta.2
   ```

4. The Publish workflow runs automatically on the tag push. A `verify` job (no
   publishing credentials) checks the tag against `deno.json`, applies the
   master rule above, and runs `deno task ci` plus the consumer smoke checks.
   Only then does the `publish` job, the sole holder of `id-token: write`, run
   `deno publish`.

The tag (without the `v` prefix) must match the version in `deno.json`. Run
`deno task publish:dry-run` locally before tagging to validate the package.

Third-party GitHub Actions are pinned to full commit SHAs with a trailing
`# vX.Y.Z` comment. When bumping one, resolve the new tag to its commit
(`git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag> 'refs/tags/<tag>^{}'`,
preferring the dereferenced `^{}` line for annotated tags) and update the
comment to match.
