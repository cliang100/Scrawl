package models

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"github.com/gorilla/websocket"
	"sync"
)

type Message struct {
	Type	string		`json:"type"`
	Data	interface{}	`json:"data"`
	RoomID	string		`json:"roomId,omitempty"`
	UserID 	string		`json:"userId,omitempty"`	
}

type Client struct {
	ID		string
	RoomID	string
	Conn	*websocket.Conn
	Send	chan Message
}

type Hub struct {
	Clients		map[*Client]bool
	Rooms		map[string]map[*Client]bool
	Register	chan *Client
	Unregister 	chan *Client
	Broadcast 	chan Message
}

type Room struct {
	Code	string
	HostID	string
	Players	[]*Player
	State	string
}

type Player struct {
	ID		string
	Name	string
	Score	int
	IsHost	bool
}

type RoomManager struct {
	Rooms 	map[string]*Room
	mu		sync.RWMutex
}

func (rm *RoomManager) CreateRoom(hostID string) *Room {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	roomCode := generateRoomCode()

	room := &Room{
		Code:		roomCode,
		HostID:		hostID,
		Players:	[]*Player{{ID: hostID, Name: "Player 1", IsHost: true}},
		State:		"lobby",
	}

	rm.Rooms[roomCode] = room
	return room
}

func (rm *RoomManager) JoinRoom(roomCode, playerID string) (*Room, error) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, exists := rm.Rooms[roomCode]
	if !exists {
		return nil, fmt.Errorf("room not found")
	}

	for _, player := range room.Players {
		if player.ID == playerID {
			return room, nil
		}
	}

	playerNum := len(room.Players) + 1
	newPlayer := &Player{
		ID:		playerID,
		Name:	fmt.Sprintf("Player %d", playerNum),
		IsHost: false,
	}

	room.Players = append(room.Players, newPlayer)
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