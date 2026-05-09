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
