# Local development

- Launch persistent services only from the repository root with
  `docker compose`. Never run `npm run dev` or Vite directly on macOS.
- The assigned port is 5174. If it is busy, identify the occupant instead of
  choosing another port.
- Another development stack may run alongside this one. The published ports do
  not collide and Docker Desktop has the headroom; do not warn or wait over it.
  Never stop another project silently.
- Before a 3D end-to-end campaign (`node e2e/campaign.mjs scene-`), list active
  Compose projects and ask for any other development stack to be stopped:
  `site-anym`, `stellary`, `helios`. GPU contention is what makes `scene-cut`
  crash the renderer, and that campaign is the only thing here that needs an
  idle machine. `stellary-ci` may remain active.
- Run tests, typechecks, and one-off commands with `docker compose run --rm`,
  for example `docker compose run --rm app npm test`. Do not leave watch mode
  running unless asked.
- Serialize rebuilds with
  `COMPOSE_PARALLEL_LIMIT=1 docker compose up -d --build`.
- Never use `docker compose down -v` without an explicit request.
- See `docs/local-docker-development.md` for commands and routes.
