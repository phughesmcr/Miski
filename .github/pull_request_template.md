# Pull Request Template

## Description

Please include a summary of the change or which issue is fixed. Please also include relevant motivation and context.
List any dependencies that are required for this change.

## Type of change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] This change requires a documentation update

## How Has This Been Tested?

Please describe the tests that you ran to verify your changes. Provide instructions so we can reproduce. Please also
list any relevant details for your test configuration

## Performance

- [ ] `deno task bench:gc` passes locally
- [ ] This change does not worsen benchmark-sensitive paths; benchmark output is included when relevant

Include `deno task bench` results for changes touching ECS runtime hot paths, benchmark fixtures,
storage/query/component/entity/system behavior, or performance documentation.

## Checklist

- [ ] `deno task ci` passes locally
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made any corresponding changes to the documentation
- [ ] My changes generate no new warnings or errors
- [ ] New and existing unit tests are covered by the local validation run
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] Any dependent changes have been merged and published in downstream modules
- [ ] I have checked my code and corrected any misspellings
