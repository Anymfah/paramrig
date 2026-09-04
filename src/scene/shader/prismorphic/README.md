# Prismorphic's material-graph engine, vendored

This directory is a **versioned copy** of the material-graph engine from the
Prismorphic repository. It is not a workspace dependency and it is not a git
submodule: the copy *is* the contract. Prismorphic may move on; this copy does
not, until somebody deliberately takes a newer one and records it here.

## Provenance

- Repository: `prismorphic`, on the same machine at `~/Documents/repos/prismorphic`
- Commit: `2d829a02a5c12128951367939c400efed475124e`
  — *fix: stop offering a guest sliders the shader cannot answer*
- Taken on: 4 September 2026

| File here | Taken from |
| --- | --- |
| `material-graph.ts` | `types/material-graph.ts` |
| `material-graph-glsl.ts` | `types/material-graph-glsl.ts` |
| `material-graph-glsl-errors.ts` | `types/material-graph-glsl-errors.ts` |
| `material-graph-diagnostics.ts` | `types/material-graph-diagnostics.ts` |
| `material.ts` | `types/material.ts` — brought along; the four above will not compile without it |
| `material-recipe.ts` | `types/material-recipe.ts` — likewise |
| `injectCompiledGraphShader.ts` | `packages/runtime-preview/src/injectCompiledGraphShader.ts` |

## Local modifications

Seven, all of them to satisfy this repository's stricter compiler and linter
rather than to change behaviour. Every one is a place where Prismorphic's own
build is more forgiving than this one; none of them changes a value, a shape or
a line of emitted GLSL.

| Where | What | Why |
| --- | --- | --- |
| `material-graph-glsl-errors.ts` | `angle[1]`, `desktop[3]`, `bareLine[1]` fall back to `'error'` | `noUncheckedIndexedAccess`: a regex group is `string \| undefined` here |
| `material-graph-glsl-errors.ts` | `match[1]`, `match[2]` fall back to `''` | the same |
| `material-graph.ts` | `guest.baseColor[index] ?? 0` | the same |
| `material-graph.ts` | `PrismorphicGraphExtension` is a type alias rather than an empty interface | `@typescript-eslint/no-empty-object-type` |
| `material-graph-glsl.ts` | `emitRecipeCall`'s first parameter renamed to `_graph` | unused, and this build says so |
| `material-graph-glsl.ts` | `glslVec4` exported | unused here, kept so the diff against Prismorphic stays small |

## What the scene uses, and what it does not

The scene reads the **compiler** and the **injection**, and the sanitising and
defaults around them. Everything about Prismorphic's own document — recipes,
guests and hosts, the material library — comes along because the compiler is
written against it, and is not reached from the scene editor: a scene material
holds a `MaterialGraphDocument` and nothing else of Prismorphic's.

The node *types* are adapted rather than used as they stand. Prismorphic hard-
codes its thirty-one kinds in tables spread across its editor; here they are
entries in an injectable registry — `src/scene/shader/registry.ts` — which the
compiler reads. That is the one deliberate divergence, and it is what lets this
editor add Blender's nodes without touching the copy.

## Taking a newer copy

Copy the seven files again, re-apply the table above, and update the commit and
the date. If a modification is no longer needed, take it out of the table rather
than leaving it there: a list of changes nobody has checked is worse than none.
