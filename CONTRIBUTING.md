# Contributing

ParamRig is developed in the open. Issues and pull requests are welcome; this page says how the
repository works so that a contribution lands without a round trip.

## Running it

Everything runs in Docker Compose from the repository root; nothing needs a Node installation on
the host. `docs/local-docker-development.md` has the commands. The short version:

```sh
docker compose up -d                                  # the workbench, at http://localhost:5174/
docker compose run --rm app npm test                  # the unit tests
docker compose run --rm app npm run typecheck
docker compose run --rm app npm run lint
docker compose run --rm app npm run test:web-service  # the connected-project service
docker compose run --rm app npm run build
docker compose run --rm app npm run build:web-sdk     # the @paramrig/web package, and its check
docker compose run --rm app npm run build:sdks
docker compose run --rm app npm run test:sdks
docker compose run --rm app npm run build:modules -- --matrix
```

That list, in that order, is what `.github/workflows/verify.yml` runs on every push and pull
request. A change is ready when it passes locally; the workflow is there to say so in public.

## Issues and discussions

Issues arrive through two forms, a bug report and an idea, and both ask where in the repository the
thing lives: the workbench, the local service and `@paramrig/web` fail in different ways and a
report that names one saves a round trip. Anything not yet shaped like a defect or a request — how
do I, is this supposed to, look at the rig I built — belongs in
[Discussions](https://github.com/Anymfah/paramrig/discussions), where it can stay a conversation.

## Pull requests

`main` is protected. A pull request needs the `verify` check to pass and is merged by the
maintainer; force pushes and deletions of `main` are refused for everyone. Keep a pull request to
one change, and say in its description what a reviewer should look at and how to see the change
working. Screenshots or a short recording help for anything visual.

Conventions that apply to every commit are in `AGENTS.md`: English throughout, no AI attribution
in commit messages, and the editor's minimal-UI rules. Commit subjects here are sentences that say
what is now true, not labels.

## Where things live

- `src/` — the workbench: library, editors, controls, the connected web workspace.
- `services/web/` — the local service that reads and writes a connected project's `.paramrig`.
- `packages/` — the public Core, Audio, Sound Labs, browser audio, Vector, Scene, Controls and Web
  workspaces. Each README documents its standalone integration contract.
- `examples/sdk/` — executable consumers of the published packages, independent of the workbench.
- `docs/` — how the parts work, and the record of each roadmap prompt and what it changed.
- `e2e/` — browser checks that drive a real GPU Chrome on the developer's machine; they are not
  part of the public workflow and stay a local gate.

## Releases

`@paramrig/web` is published by `.github/workflows/release-web.yml` when the maintainer pushes a
`web-v<version>` tag that matches `packages/web-sdk/package.json`. The same workflow writes the
GitHub release afterwards, from the commits that touched the package since the previous tag.
The other SDKs use the coordinated `sdk-v<version>` workflow. Both release paths validate their
artifacts before publication. [Modular releases](docs/modular-releases.md) covers initial package
bootstrap, trusted publishers and registry verification. The workbench is deployed as a static
site from `npm run build:app`; selected-domain archives use `npm run build:modules`.

## Security

Please do not open a public issue for a vulnerability. `SECURITY.md` says how to report one.
