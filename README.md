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
The game uses a WebSocket hub pattern to manage real-time communication:
- Game rooms with multiple players
- Turn-based drawing system
- Real-time canvas synchronization
- Chat and guessing mechanics

## Game Flow
1. Players join a room
2. One player draws, others guess
3. Correct guesses earn points
4. Turns rotate when time expires or word is guessed