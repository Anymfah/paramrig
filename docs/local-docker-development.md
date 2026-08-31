# Local development with Docker Desktop

The whole development runtime lives in the Compose application `paramrig`,
visible as a project group in Docker Desktop.

| Service | Address | Role |
| --- | --- | --- |
| `app` | <http://localhost:5174> | Vite workbench with hot reload |

Port `5174` is fixed. Stellary already uses `5173`; do not fall back to another
port if `5174` is busy — identify the occupant instead.

## Daily commands

From the repository root:

```bash
docker compose up -d
docker compose ps
docker compose logs -f app
docker compose stop
docker compose start
```

Docker Desktop offers the same actions with Start / Stop / Pause on the
`paramrig` application. `stop` keeps the container and volumes so Start can
bring them back. After a Node or lockfile change:

```bash
COMPOSE_PARALLEL_LIMIT=1 docker compose up -d --build
```

`node_modules` lives in a Docker volume so host installs never collide with
the container.

## Tests and one-off tasks

Agents and developers must use disposable containers:

```bash
docker compose run --rm app npm test
docker compose run --rm app npm run lint
docker compose run --rm app npm run typecheck
docker compose run --rm app npm run build
```

Do not add `--service-ports` to one-off tasks: that would try to bind `5174`
a second time.

## Stop and data

```bash
docker compose stop       # reversible, the daily default
docker compose down       # remove the container and network, keep volumes
```

Never run `docker compose down -v` without an explicit request.

## Resource limits

The `app` service has CPU, memory, and PID ceilings so a Vite or Three.js
loop cannot take the whole machine. They are not reservations while idle.

## Other Compose projects

Before `docker compose up`, list running Compose projects. If `site-anym`,
`stellary`, `helios`, or another development stack is already up, warn and
wait; never start both stacks or stop the other one silently. `stellary-ci`
may remain active.
