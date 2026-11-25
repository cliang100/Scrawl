package game

import "encoding/json"

// Message is what the server sends to a client.
type Message struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

// Incoming is what a client sends. Data is decoded per message type.
type Incoming struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// Conn is one player's connection. Send must not block, and must encode the
// message before returning because it points at live room state.
type Conn interface {
	Send(Message)
	Close()
}

type Player struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	IsHost bool   `json:"isHost"`
	Score  int    `json:"score"`

	token   string
	conn    Conn
	guessed bool
	// dropped counts disconnects so an old grace timer can't remove a player who came back
	dropped int
}

type Settings struct {
	Rounds   int `json:"rounds"`
	DrawTime int `json:"drawTime"`
}

type data = map[string]any
