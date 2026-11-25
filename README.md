# Scrawl

A multiplayer drawing and guessing game inspired by Skribbl.io. Players take turns drawing while the others guess in real time.

## Tech stack

- **Backend:** Go, Gin for HTTP, gorilla/websocket
- **Frontend:** vanilla JavaScript and HTML5 Canvas
- **Protocol:** JSON messages over one WebSocket per player
- **Tooling:** Go tests with the race detector and `testing/synctest`, GitHub Actions, Docker

## Run it

```bash
go run ./cmd/server
```

Open http://localhost:8080 in two browser windows (or two private windows) to play against yourself.

With Docker:

```bash
docker build -t scrawl .
docker run -p 8080:8080 scrawl
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `ALLOWED_ORIGINS` | none | Comma-separated sites, besides the server's own, that may open a WebSocket. Needed when the frontend is hosted separately. |

## Tests

```bash
go test -race ./...
```

`internal/game` covers the rules: joining, reconnecting, settings, word choice, scoring, turn and round order, hints, timers, players leaving mid-turn, canvas validation and undo, and malformed or concurrent messages. Timer tests use `testing/synctest`, so a full game runs in milliseconds. `internal/server` covers the HTTP routes, the WebSocket origin check, and the message size and rate limits.

CI runs formatting, `go vet`, the tests, `govulncheck`, a JavaScript syntax check, and a Docker build on every push.

## How it works

**Architecture**

- `internal/game` holds all game state and rules. Each `Room` has one mutex, and every message and timer for that room runs while holding it, so rooms never race and don't block each other.
- `internal/server` turns WebSockets into calls on a room. Each connection has a read goroutine and a write goroutine with a buffered channel. A client that falls too far behind is disconnected instead of slowing the room down.
- Timers use `time.AfterFunc`. Every phase change bumps a phase number, and a timer that fires for an old phase does nothing. This avoids cancelling channels by hand.

**Game flow**

1. The host creates a room and shares the invite link. Up to 8 players can join.
2. The host picks the rounds (1 to 5) and draw time (30 to 180 seconds), then starts the game.
3. The drawer has 15 seconds to choose one of three words. If they don't, the first is picked.
4. Others guess in chat. Letters are revealed as hints at fixed points in the turn: one hint for words under 5 letters, two for 5 to 9, three for 10 or more.
5. A correct guess scores 50 to 300 points depending on time left, and the drawer gets a quarter of that. The turn ends when everyone has guessed or time runs out.
6. After every player has drawn once, the round advances. After the last round, the final scores are shown and the host can start again.

**Fair play**

- The server only sends the word to the drawer. Guessers get a mask like `_ _ _ _ _` that fills in with hints.
- Players who have guessed, and the drawer, chat in a separate channel that other guessers never receive.
- The drawer can only pick one of the three offered words, and only the drawer's canvas messages are accepted.

**Reconnecting**

Joining returns a secret token, kept in the tab's session storage. Reloading the page or moving from the landing page to the room reconnects with that token and keeps the same seat, score and host status. A player who disconnects keeps their seat for 20 seconds. If they don't return, they're removed, the next player becomes host if needed, and a drawer's turn is skipped.

**Canvas**

Everyone draws on the same 800x600 coordinate space, scaled by CSS, so window size doesn't matter. Strokes are sent in batches of up to 20 points. The server validates every batch and keeps the turn's drawing, so a player who reconnects sees the current canvas. Undo removes the last stroke or fill everywhere.

**Limits**

Messages are capped at 16 KB and 60 per second per connection. The server holds at most 500 rooms. Pings close dead connections after 60 seconds. Player names and chat are always rendered as text, and the server sets a Content Security Policy.

## Deploying

The server keeps rooms in memory, so it must run as a **single instance** of a long-running process that supports WebSockets, such as a container on Render, Fly.io or Railway. Use the Dockerfile and point the health check at `/healthz`. Rooms are lost when the process restarts or a free tier puts it to sleep.

### Optional: frontend on Netlify

Netlify can't run the Go server, but it can host the pages:

1. Deploy the server first and note its URL, for example `https://scrawl-api.onrender.com`.
2. Create a Netlify site from this repo. `netlify.toml` already sets the build command and publish folder.
3. In Netlify, set the environment variable `BACKEND_URL` to the server URL.
4. On the server, set `ALLOWED_ORIGINS` to the Netlify site URL, for example `https://scrawl.netlify.app`.

The build script (`scripts/netlify-build.sh`) copies `web/`, points the pages at `BACKEND_URL`, and writes the redirect and security headers.

## Project structure

```
cmd/server/          entry point, configuration and graceful shutdown
internal/game/       rooms, rules, timers, canvas validation, tests
internal/server/     HTTP routes and WebSocket connections, tests
internal/words/      word list
web/                 pages, styles, scripts and icons
scripts/             Netlify build script
```
