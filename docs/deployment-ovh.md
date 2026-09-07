# Deploying the application

ParamRig runs at `app.paramrig.com`. It is the application itself, not a
reduced demonstration of it: every editor, every controller and every bundled
example is the code this repository builds. What it does not have yet is an
account and a server, so a person's work stays in their own browser.

The marketing and documentation website is a separate build in a separate
repository, `Anymfah/paramrig-website`, served from `paramrig.com`.

## Build

From this repository:

```sh
docker compose run --rm app npm run build:app
```

The `app` mode adds one notice to the library, saying that work is held in the
browser and that there is no cloud backup. It adds no authentication, no
telemetry, no upload and no synchronisation. The output is `dist/`, static
files only.

## OVH setup

Give `app.paramrig.com` its own document root in OVH Multisite. Turn HTTPS on
and confirm the destination before transferring anything. Transfer over SFTP or
another encrypted method the subscribed offer supports. Host credentials never
go into the repository or into a public workflow.

Upload the whole of `dist/`, including the hidden `.htaccess`. Its rewrite
covers every route the router declares, so a direct visit or a reload answers
with the application instead of Apache's 404: `/r/<any rig>`, `/web`, `/docs`,
`/docs/controls`, `/docs/vector-rigs` and `/docs/scene-rigs`. Missing static
assets are not rewritten to HTML. `src/App.routes.test.ts` reads both
`src/App.tsx` and `public/.htaccess`, and fails when a route is added without
its rewrite.

The application sends `X-Robots-Tag: noindex, nofollow`. That is deliberate and
it stays: every route here renders on the client, so a crawler would index empty
shells, and the pages meant to be found are the website's.

Rename or download the deployed directory before replacing it. Keep the copy
until the new upload passes the checks below; restoring it is the rollback.

## What the deployment waits on

Two things outside this repository. Measured on 7 September 2026:

- `paramrig.com` and `www.paramrig.com` both resolve to `213.186.33.5` and
  refuse HTTPS: `curl -sI https://paramrig.com/` returns nothing. The library
  links to `https://paramrig.com/docs/persistence/` from
  `src/library/LibraryPage.tsx`. That link is deliberately unchanged: the
  address is right, it is the site behind it that is missing.
- `app.paramrig.com` has no DNS record at all.

Neither is fixed here, because neither lives here.

## Acceptance

- Open and reload every route directly over HTTPS: a rig, `/web`, `/docs`,
  `/docs/controls`, `/docs/vector-rigs` and `/docs/scene-rigs`.
- Change a parameter, reload, and verify the local draft comes back.
- Copy and download the JSON export; confirm no source file changed.
- Check keyboard navigation and the inspector on a narrow viewport.
- Check the SVG example with WebGL unavailable, and the explicit error the 3D
  renderer gives in that case.
- Verify the library states that storage is browser-only and links to the
  public documentation on it.

## About the cloud

Accounts and server-side storage are not part of this deployment, and nothing
here assumes them. When they arrive they arrive at this same origin, so what a
person opens does not move. Local data written before then belongs to the
browser and this origin; migrating it into an account is a decision to make
when the account exists, not a promise this deployment makes.
