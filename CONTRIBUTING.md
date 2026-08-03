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

- Hot paths return **borrowed** dense views (`queryList`, `getChanged`, `getOwners`, `getActive`) that are valid only until the next world mutation or `refresh`
- `*Snapshot` / `querySnapshot` / `toArray` helpers allocate stable copies for tools, tests, and non-frame-critical code

Layout sketch: `src/{world,component,entity,query,system,archetype,checkpoint,rollback,schema,value}/`. Demos live in `example/`; throughput and GC budgets in `bench/`. See [`test/README.md`](test/README.md) for how tests map to API domains.

Validation: `deno task ci` before every PR (includes the GC allocation gate). For performance-sensitive changes also run `deno task bench` and ideally `deno task bench:all` (throughput + retained memory).

## Naming and comments

- Prefer `.storage.partitions` in new docs and examples (`.partitions` is an alias)
- Prefer `entityIndex` / `queryList` `indices` for SoA writes; packed handles for identity APIs (`isActive`, ownership)
- Document the layered query pattern (`query` / `queryList` / `querySnapshot`) rather than renaming methods
- Comment *why* on preflight, atomicity, and borrowed lifetimes; avoid comments that only restate the identifier
- ASCII-only in `src/` comments (`prefer-ascii` lint)

## Releasing

JSR publishing is triggered by semver git tags, not by merging to `main`.

1. Bump `"version"` in `deno.json`.
2. Merge to `main` (CI must pass).
3. Create and push a matching tag:

   ```sh
   git tag v1.0.0-alpha.3
   git push origin v1.0.0-alpha.3
   ```

4. The Publish workflow runs automatically on the tag push.

The tag (without the `v` prefix) must match the version in `deno.json`. Run
`deno task publish:dry-run` locally before tagging to validate the package.
