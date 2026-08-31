# Local development

- Launch persistent services only from the repository root with
  `docker compose`. Never run `npm run dev` or Vite directly on macOS.
- The assigned port is 5174. If it is busy, identify the occupant instead of
  choosing another port.
- Before any `docker compose up`, list active Compose projects. If
  `site-anym`, `stellary`, `helios`, or another development stack is already
  running, warn the user and wait; never start both stacks or stop the other
  project silently. `stellary-ci` may remain active.
- Run tests, typechecks, and one-off commands with `docker compose run --rm`,
  for example `docker compose run --rm app npm test`. Do not leave watch mode
  running unless asked.
- Serialize rebuilds with
  `COMPOSE_PARALLEL_LIMIT=1 docker compose up -d --build`.
- Never use `docker compose down -v` without an explicit request.
- See `docs/local-docker-development.md` for commands and routes.
