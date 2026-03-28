package models

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"sync"

	"github.com/gorilla/websocket"
)

type Message struct {
	Type   string      `json:"type"`
	Data   interface{} `json:"data"`
	RoomID string      `json:"roomId,omitempty"`
	UserID string      `json:"userId,omitempty"`
}

type Client struct {
	ID     string
	RoomID string
	Conn   *websocket.Conn
	Send   chan Message
	Name   string
}

type Hub struct {
	Clients    map[*Client]bool
	Rooms      map[string]map[*Client]bool
	Register   chan *Client
	Unregister chan *Client
	Broadcast  chan Message
}

type Room struct {
	Code            string
	Players         map[string]*Player
	HostID          string
	State           string
	CurrentDrawerID string
	CurrentWord     string
	TurnOrder       []string
	Round           int
}

type Player struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	IsHost bool   `json:"isHost"`
}

type RoomManager struct {
	Rooms map[string]*Room
	mu    sync.RWMutex
}

func (rm *RoomManager) CreateRoom(hostID, name, avatar string) *Room {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	roomCode := generateRoomCode()

	hostPlayer := &Player{
		ID:     hostID,
		Name:   name,
		Avatar: avatar,
		IsHost: true,
	}

	room := &Room{
		Code:            roomCode,
		Players:         make(map[string]*Player),
		HostID:          hostID,
		State:           "waiting",
		CurrentDrawerID: hostID,
		TurnOrder:       []string{hostID},
		Round:           1,
	}

	room.Players[hostID] = hostPlayer
	rm.Rooms[roomCode] = room

	fmt.Printf("Creating host player: name=%s, avatar=%s\n", name, avatar)
	return room
}

func (rm *RoomManager) JoinRoom(roomCode, playerID, name, avatar string) (*Room, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.Rooms[roomCode]
	if !exists {
		return nil, fmt.Errorf("room not found")
	}

	if _, exists := room.Players[playerID]; !exists {
		newPlayer := &Player{
			ID:     playerID,
			Name:   name,
			Avatar: avatar,
			IsHost: false,
		}

		room.Players[playerID] = newPlayer
		room.TurnOrder = append(room.TurnOrder, playerID)
		fmt.Printf("Creating joining player: name=%s, avatar=%s\n", name, avatar)
	}

	return room, nil
}

func generateRoomCode() string {
	const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, 6)

	for i := range result {
		num, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		result[i] = charset[num.Int64()]
	}

	return string(result)
}
