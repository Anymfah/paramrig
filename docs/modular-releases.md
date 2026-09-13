# Releasing modular SDKs

New engine and control packages start at `0.1.0`. Web keeps its independent version and `web-v*` workflow. Its `0.1.2` declaration update retains the public API and standalone installation while supporting strict NodeNext consumers after the shared types moved into Core.

## Validate before publishing

The `verify` workflow builds the application and packages, installs consumers from npm tarballs, checks TypeScript and Node/browser use, and verifies selective distributions. It retains the validated tarballs and application archives as an artifact named with the source commit. Local equivalents run through Docker Compose; see [Modular packages](./modular-packages.md).

Do not publish an artifact from a different revision than the validated one. Inspect the tarball file list and integrity. An npm release is immutable: fix a defective release with a new version.

## Initial package bootstrap

A trusted publisher can only be configured for a package that already exists. The first publication therefore requires an authenticated npm maintainer and any account-level two-factor authentication. Publish the **validated artifact** for each new package in this order:

1. Core.
2. Audio.
3. Sound Labs and browser audio.
4. Vector and Scene.
5. Controls.

Use the tarballs retained by successful CI for the exact source commit. Do not create placeholder packages or publish different local builds merely to reserve names. The initial maintainer publication does not have CI-generated provenance; later OIDC publications do.

After each package exists, configure the trusted publisher for `Anymfah/paramrig`, workflow file `release-sdks.yml`, with direct publication allowed. This workflow does not use a GitHub environment. Keep Web's existing `release-web.yml` publisher separate. Inspect existing publisher configuration before adding a relationship; do not replace unrelated publisher access.

npm documents the existing-package and authentication prerequisites in [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/) and workflow matching in [trusted publishing](https://docs.npmjs.com/trusted-publishers/). The workflow installs npm 11 for OIDC support.

## Coordinated releases

Push `sdk-v<version>` only for a reviewed commit whose new package manifests all declare that version. The release workflow rebuilds and tests the packages and consumers before publication. It checks every intended version against the registry before uploading any package, publishes in dependency order, and permits an identical already-published artifact when resuming a partial release. A different artifact under the same version is an error.

After publication it installs from npm, compares registry integrity with the validated artifact and repeats the consumer checks. That check is also available as:

```sh
docker compose run --rm app npm run test:sdks -- --registry
```

Publish a separate `web-v<version>` tag only when Web's artifact changes.

## Application and product pages

After the SDK installations pass, deploy the full application from an exact Git commit through the existing private website workflow. Run its dry-run mode first and inspect the target and changes. App and site transfers share one concurrency group. Real transfers repeat the dry run, retain previous hashed assets and transfer the entry point after its resources. The application records its source revision in `release.json`.

Verify cold navigation to each domain, existing document recovery, save/reload, playback and exports, module transitions and the network resources actually loaded. Then publish the pages that announce those capabilities. A rollback restores the prior server entry points and backed-up files; it does not modify browser storage. An npm rollback uses a new corrective version, never an overwritten artifact.
