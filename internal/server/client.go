package server

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"scrawl/internal/game"

	"github.com/gorilla/websocket"
)

const (
	maxMessageBytes   = 16 * 1024
	maxMessagesPerSec = 60
	pongWait          = 60 * time.Second
	pingEvery         = 25 * time.Second
	writeWait         = 10 * time.Second
	// enough to absorb a burst of strokes; a client this far behind is dropped
	sendBuffer = 256
)

// client is one WebSocket. readPump and writePump each run in their own goroutine.
type client struct {
	conn    *websocket.Conn
	manager *game.Manager
	send    chan []byte
	done    chan struct{}
	once    sync.Once

	room   *game.Room
	player *game.Player
}

func (c *client) Send(m game.Message) {
	raw, err := json.Marshal(m)
	if err != nil {
		log.Printf("marshal %s: %v", m.Type, err)
		return
	}
	select {
	case c.send <- raw:
	case <-c.done:
	default:
		c.Close()
	}
}

func (c *client) Close() {
	c.once.Do(func() { close(c.done) })
}

func (c *client) readPump() {
	defer func() {
		c.Close()
		if c.room != nil {
			c.room.Disconnect(c.player, c)
		}
	}()

	c.conn.SetReadLimit(maxMessageBytes)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	window, count := time.Now(), 0
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if time.Since(window) >= time.Second {
			window, count = time.Now(), 0
		}
		if count++; count > maxMessagesPerSec {
			return
		}

		var msg game.Incoming
		if json.Unmarshal(raw, &msg) != nil {
			continue
		}
		c.handle(msg)
	}
}

func (c *client) handle(msg game.Incoming) {
	if c.room != nil {
		c.room.Handle(c.player, c, msg)
		return
	}

	var d struct {
		RoomCode string `json:"roomCode"`
		Name     string `json:"name"`
		Avatar   string `json:"avatar"`
		Token    string `json:"token"`
	}
	if json.Unmarshal(msg.Data, &d) != nil {
		return
	}
	var err error
	switch msg.Type {
	case "createRoom":
		c.room, c.player, err = c.manager.Create(d.Name, d.Avatar, c)
	case "joinRoom":
		c.room, c.player, err = c.manager.Join(d.RoomCode, d.Name, d.Avatar, d.Token, c)
	default:
		return
	}
	if err != nil {
		c.room, c.player = nil, nil
		c.Send(game.Message{Type: "roomError", Data: map[string]string{"error": err.Error()}})
	}
}

func (c *client) writePump() {
	ping := time.NewTicker(pingEvery)
	defer func() {
		ping.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case raw := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if c.conn.WriteMessage(websocket.TextMessage, raw) != nil {
				return
			}
		case <-ping.C:
			if c.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)) != nil {
				return
			}
		case <-c.done:
			return
		}
	}
}
