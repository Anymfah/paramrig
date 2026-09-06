# Public demo deployment

The product and marketing website are separate builds and repositories. The
website lives in the private `Anymfah/paramrig-website` repository; its public
documentation is intended for <https://paramrig.com/docs/>.

## Build

Run this from the public product repository:

```sh
docker compose run --rm app npm run build:demo
```

The `demo` build mode displays a browser-storage notice in the library. It adds
no authentication, telemetry, uploads, or cloud synchronization.

## OVH setup

Associate `demo.paramrig.com` with its own document root in OVH Multisite.
Enable HTTPS and verify the exact destination before transferring files. Use
SFTP or another encrypted transfer method supported by the subscribed offer.
Never commit host credentials or put them in a public workflow.

Upload the contents of `dist/`, including the hidden `.htaccess`. The rewrite
rules cover every route the router declares, so a direct visit or a reload
answers with the application rather than with Apache's 404: `/r/<any rig>`,
`/web`, `/docs`, `/docs/controls`, `/docs/vector-rigs` and `/docs/scene-rigs`.
Missing static assets are not rewritten to HTML. `src/App.routes.test.ts` reads
both `src/App.tsx` and `public/.htaccess` and fails when a route is added without
its rewrite. The demo is marked `noindex`; discovery pages belong on the public
website.

Download or rename the current deployed directory before replacement. Keep it
until the new version passes its smoke checks; restore it to roll back.

## Before any of this

Two things outside this repository are not ready, and the deployment waits on
them. Measured on 6 September 2026:

- `paramrig.com` has an A record but refuses HTTPS: `curl -sI https://paramrig.com/`
  returns nothing, and `http://` redirects to `www.paramrig.com`. The library
  links to `https://paramrig.com/docs/persistence/` from
  `src/library/LibraryPage.tsx`; that link is deliberately unchanged, because the
  address is right and it is the site that is missing.
- `demo.paramrig.com` has no DNS record at all.

The public site is not in this repository, so neither is fixed here.

## Acceptance

- Open and reload every route directly over HTTPS: a rig, `/web`, `/docs`,
  `/docs/controls`, `/docs/vector-rigs` and `/docs/scene-rigs`.
- Open and reload both rig URLs directly over HTTPS.
- Change a parameter, reload and verify that its local draft is restored.
- Copy and download the JSON export; confirm that no source files are changed.
- Check keyboard navigation and the inspector on a narrow viewport.
- Check the SVG example when WebGL is unavailable and the explicit error
  message for the 3D renderer.
- Verify that the library explains browser-only storage and links to the
  public data documentation.

The cloud application is not part of this deployment. Local demo data is
specific to the demo origin and is not promised to migrate into future cloud
accounts.
