# CI for Model-Based Testing with quint-connect

This guide explains how to set up GitHub Actions CI for projects using `@firfi/quint-connect`.

## Prerequisites

- A Node.js project using pnpm
- Quint specs (`.qnt` files) and corresponding integration tests
- `@firfi/quint-connect` installed as a dependency

## Setup

1. Copy the workflow file into your project:

```
cp .github/workflows/mbt.yml <your-project>/.github/workflows/mbt.yml
```

Or create `.github/workflows/mbt.yml` manually with the following content:

```yaml
name: Model-Based Tests
on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  mbt:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install
      - run: pnpm test
```

2. Ensure your `package.json` has a `test` script that runs your MBT tests (e.g., via vitest):

```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

3. Ensure your `package.json` specifies the pnpm version via `packageManager` field so `pnpm/action-setup` picks it up automatically:

```json
{
  "packageManager": "pnpm@10.29.3"
}
```

## Timeout

Quint model checking can be slow, especially with many traces or large state spaces. The workflow sets `timeout-minutes: 10` by default. Increase this if your specs are complex or you generate many traces.

## Customization

### Running only MBT tests

If your test suite includes both unit tests and MBT integration tests, you can run them separately by configuring vitest projects or using test name filters:

```yaml
- run: pnpm vitest run --testPathPattern integration
```

### Matrix testing

To test against multiple Node.js versions:

```yaml
strategy:
  matrix:
    node-version: [20, 22]
steps:
  - uses: actions/setup-node@v4
    with:
      node-version: ${{ matrix.node-version }}
```

### Caching quint

Quint is installed via npm (`@informalsystems/quint`) as a transitive dependency of `@firfi/quint-connect` and will be cached automatically by `pnpm install` with the `cache: pnpm` option.
