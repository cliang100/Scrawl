package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func start(t *testing.T) *httptest.Server {
	t.Helper()
	gin.SetMode(gin.TestMode)
	srv := httptest.NewServer(New("../../web", []string{"https://scrawl.example"}))
	t.Cleanup(srv.Close)
	return srv
}

func dial(t *testing.T, srv *httptest.Server, origin string) (*websocket.Conn, error) {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", http.Header{"Origin": {origin}})
	if err == nil {
		t.Cleanup(func() { conn.Close() })
	}
	return conn, err
}

func read(t *testing.T, c *websocket.Conn, kind string) map[string]any {
	t.Helper()
	c.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var m struct {
			Type string
			Data map[string]any
		}
		if err := c.ReadJSON(&m); err != nil {
			t.Fatalf("waiting for %s: %v", kind, err)
		}
		if m.Type == kind {
			return m.Data
		}
	}
}

func send(t *testing.T, c *websocket.Conn, kind string, d any) {
	t.Helper()
	if err := c.WriteJSON(map[string]any{"type": kind, "data": d}); err != nil {
		t.Fatal(err)
	}
}

func TestPages(t *testing.T) {
	srv := start(t)
	for path, want := range map[string]int{
		"/": 200, "/ABC123": 200, "/healthz": 200, "/static/js/game.js": 200, "/abc": 404, "/favicon.ico": 404,
	} {
		res, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != want {
			t.Errorf("%s = %d, want %d", path, res.StatusCode, want)
		}
		if res.Header.Get("Content-Security-Policy") == "" {
			t.Errorf("%s has no CSP", path)
		}
	}
}

func TestOriginCheck(t *testing.T) {
	srv := start(t)
	for origin, ok := range map[string]bool{srv.URL: true, "https://scrawl.example": true, "https://evil.example": false} {
		if _, err := dial(t, srv, origin); (err == nil) != ok {
			t.Errorf("origin %s: err = %v", origin, err)
		}
	}
}

func TestCreateJoinAndStart(t *testing.T) {
	srv := start(t)
	host, _ := dial(t, srv, srv.URL)
	send(t, host, "createRoom", map[string]string{"name": "host", "avatar": "🎨"})
	code := read(t, host, "roomCreated")["roomCode"]

	guest, _ := dial(t, srv, srv.URL)
	send(t, guest, "joinRoom", map[string]any{"roomCode": code, "name": "guest", "avatar": "🦊"})
	read(t, guest, "roomJoined")
	send(t, host, "startGame", nil)
	read(t, guest, "gameStarted")
	read(t, host, "gameStateUpdate")
}

func TestBadMessagesDoNotKillServer(t *testing.T) {
	srv := start(t)
	c, _ := dial(t, srv, srv.URL)
	for _, raw := range []string{"", "x", "null", `{}`, `{"type":"createRoom"}`, `{"type":"createRoom","data":[]}`, `{"type":"startGame","data":{"roomCode":"NOPE00"}}`} {
		c.WriteMessage(websocket.TextMessage, []byte(raw))
	}
	send(t, c, "createRoom", map[string]string{"name": "host", "avatar": "🎨"})
	read(t, c, "roomCreated")
}

func TestLimitsCloseConnection(t *testing.T) {
	srv := start(t)
	big, _ := dial(t, srv, srv.URL)
	big.WriteMessage(websocket.TextMessage, make([]byte, maxMessageBytes+1))
	flood, _ := dial(t, srv, srv.URL)
	for range maxMessagesPerSec + 5 {
		flood.WriteMessage(websocket.TextMessage, []byte("{}"))
	}
	for name, c := range map[string]*websocket.Conn{"big": big, "flood": flood} {
		c.SetReadDeadline(time.Now().Add(3 * time.Second))
		if _, _, err := c.ReadMessage(); err == nil || strings.Contains(err.Error(), "timeout") {
			t.Errorf("%s: connection stayed open (%v)", name, err)
		}
	}
}
