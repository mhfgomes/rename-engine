# Development and documentation maintenance

[Documentation home](../README.md)

## Setup and checks

Use Node.js 20 or newer with npm. This is an ESM TypeScript package with no runtime dependencies.

```sh
npm ci
npm run check
```

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check all source/test types without emitting files |
| `npm test` | Run Vitest tests |
| `npm run clean` | Remove `dist/` before rebuilding |
| `npm run build` | Clean and compile distributable JS and declarations to `dist/` |
| `npm run test:package` | Pack/install into a temporary consumer project and verify all public entries and types |
| `npm pack --dry-run` | Run prepack/build and show package contents |
| `npm run check` | Typecheck, tests, build, package smoke test, pack dry-run |

`prepack` runs the build. Set `PACKAGE_TARBALL=/path/to/package.tgz` to smoke-test an existing tarball without repacking. Declaration maps are disabled to avoid links to source files absent from the package. Source tests are excluded from the distributable. The package export map supports the root, `/sort`, and `/types`; imports of other implementation paths are not part of the contract.

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Root export surface |
| `src/types.ts` | Rule union, preview/result types, shared application contracts |
| `src/rename-engine.ts` | Name splitting, rule pipeline, validation, target resolution, conflict/status calculation |
| `src/custom-rule.ts` | Expression tokenizer/parser, helper table, evaluator, bounded compiled-expression cache |
| `src/sort.ts` | Fixed-locale comparators and ancestor-first sorting |
| `src/path-key.ts` | Internal path flavor/normalization and public key helper |
| `src/sequence.ts` | Internal safe-range sequence computation and bounded letter formatting |
| `src/limits.ts` | Exported rule/name limits |
| `src/*.test.ts` | Rule, planner, custom-expression, and ordering regression coverage |
| `scripts/package-smoke-test.mjs` | Packed-package consumer import, declaration, and export-map smoke checks |
| `docs/` | User guides and full API documentation |

The v0.2.0 regression suite includes seeded-shuffle and permutation checks across all four sort modes, ensuring reproducible order, ancestor-first placement, and child target propagation. It also covers duplicate ids, Unicode keys, regex/padding errors, reserved names, and name limits.

## Package documentation

`README.md` and `docs/` are included in npm's file allowlist, alongside `dist/`. Documentation uses relative links so the pages can be read together in a checkout or unpacked release; GitHub also resolves these links. Source `.ts` and test files are not intentionally shipped by the allowlist.

This documentation describes the v0.2.0 implementation. Release tagging/publishing remains a separate maintainer action.

## Updating the documentation

When an API or behavior changes:

1. Check `package.json` exports and `src/index.ts` before documenting a source export as public.
2. Update every changed interface field in the API/rule references.
3. Record actual runtime defaults, platform distinctions, error boundaries, and implementation limits.
4. Verify full-name versus stem transformations and zero-based versus one-based indices in examples.
5. Execute examples with exact expected outputs; type-check TypeScript snippets against the build.
6. Check relative links and npm package inclusion.
7. Run `npm run check` and describe behavior changes in migration notes.

Avoid documenting picker, execution, persistence, or undo types as implemented functions. Avoid inferring safety guarantees from an `ok` preview or its case-only advisory. For new behavior, add meaningful regression coverage to the implementation PR; documentation-only changes do not need tests that merely mirror prose.
