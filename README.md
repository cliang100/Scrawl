# Scrawl

A multiplayer drawing and guessing game inspired by Skribbl.io. Players take turns drawing while others guess in real-time.

## Tech Stack
- **Backend**: Go with Gin framework and WebSocket hub pattern
- **Frontend**: Vanilla JavaScript with HTML5 Canvas
- **Protocol**: WebSocket for real-time communication

## Quick Start
```bash
# Install dependencies
go get github.com/gin-gonic/gin

# Run the server
go run cmd/server/main.go
```

## How It Works

**State Management**
- `RoomManager` for Room isolation and `sync.RWMutex` for safety across multiple games
- Websocket hub pattern for central broadcast goroutine with per-client I/O goroutines
- In-memory state with Go maps and mutexes for sub-millisecond access
- Client ID reassignment preserving player identity across lobby to game navigation

**Game Loop & Concurrency**
- Close channel pattern for panic-free timer cancellations across goroutines
- Turn advances from either correct guesses or timeout
- Round increments after each player has had a turn to draw
- Word selection (15s by default) selects random word on timeout

**Anti-Cheating & UX**
- Hangman-style word showing letter count in word as well as revealing letters over time (45s/25s/10s remaining for words ≥10 letters; fewer hints for shorter words)
- Separate chats for guessers and correct guessers (drawer included) to prevent correct guessers from cheating
- Canvas state reconstruction to allow stroke replay for undo button. Resets on clear
- Time-based scoring rewards more points for quicker guesses. Drawer receives percentage of total points

## Game Flow
1. Players join a room via lobby overlay (host configures rounds/draw time)
2. Word selection: 15s to choose or auto-selects on timeout
3. Drawing phase: 80s to draw while others guess; hints reveal at timed intervals
4. Correct guesses award time-based points (faster = more); drawer earns percentage
5. Turn advances when all guess correctly or timer expires; rounds complete when all players have drawn
6. Game ends after configured rounds; highest score wins