# Local development with Docker Desktop

The whole development runtime lives in the Compose application `paramrig`,
visible as a project group in Docker Desktop.

| Service | Address | Role |
| --- | --- | --- |
| `app` | <http://localhost:5174> | Vite workbench with hot reload |
| `web` | proxied at `/api/web` | Feedback file service for a connected project, profile `web` |

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

## The connected project's files

The `web` service is the only one that writes outside the repository, and only
inside the connected project's `.paramrig` directory. Two things govern that:

```bash
PARAMRIG_PROJECT_DIR=/absolute/path/to/project docker compose --profile web up -d
PARAMRIG_UID=$(id -u) PARAMRIG_GID=$(id -g) docker compose --profile web up -d   # Linux
```

`PARAMRIG_UID` and `PARAMRIG_GID` decide who owns what the service writes. The
files are `0600` and the project's own agent has to read them, so on Linux — where
a bind mount keeps the container's numeric ids — they must be the ids of whoever
runs the project. Docker Desktop on macOS maps ownership itself and needs neither;
the default of `1000:1000` is the image's own user. **This has not been tried on
Linux from this repository.**

The example manifest is seeded only into an empty project directory, so
`PARAMRIG_SEED_MANIFEST=` is no longer needed to protect a real project. See
`docs/web-workspace.md`.

Node 22.6 or later is required, here and in `engines`: the service is run with
`node --experimental-strip-types`, which is where type stripping first appeared.

## Resource limits

The `app` service has CPU, memory, and PID ceilings so a Vite or Three.js
loop cannot take the whole machine. They are not reservations while idle.

## Other Compose projects

Before `docker compose up`, list running Compose projects. If `site-anym`,
`stellary`, `helios`, or another development stack is already up, warn and
wait; never start both stacks or stop the other one silently. `stellary-ci`
may remain active.
