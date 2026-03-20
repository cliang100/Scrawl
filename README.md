# Scrawl

Real-time multiplayer drawing and guessing game built in Go.

## Architecture
- WebSocket Hub Pattern for real-time communication
- Go + Gin for backend
- Vanilla JavaScript + Canvas API for frontend

## Getting Started
1. Install dependencies: `go get github.com/gin-gonic/gin`
2. Run server: `go run cmd/server/main.go`
3. Open browser to `http://localhost:8080`

## Project Structure
[Explain the folder structure we created]

## Development Phases
1. WebSocket foundation
2. Drawing canvas + sync  
3. Game loop
4. Differentiating features
5. Polish + deployment