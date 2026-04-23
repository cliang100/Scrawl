package models

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"time"
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
	Mu		   sync.RWMutex
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
	MaxRounds		int
	TurnCount		int
	CancelTimer		chan struct{}
	TimerGeneration int
	TimerDeadline	time.Time
	CorrectGuessers map[string]bool
	ChatHistory		[]ChatMessage
	RevealedIndices map[int]bool
	HintCount		int
}

type Player struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	IsHost bool   `json:"isHost"`
	Score  int	  `json:"score"`
}

type RoomManager struct {
	Rooms map[string]*Room
	mu    sync.RWMutex
}

type ChatMessage struct {
	UserID		 string		`json:"userId"`
	UserName	 string		`json:"userName"`
	Text		 string		`json:"text"`
	IsCorrect	 bool		`json:"isCorrect"`
	IsWinnerChat bool		`json:"isWinnerChat"`
	Timestamp	 time.Time	`json:"timestamp"`
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
		CorrectGuessers: make(map[string]bool),
		ChatHistory:	 make([]ChatMessage, 0),
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

	// Check if player with this ID already exists
	if _, exists := room.Players[playerID]; exists {
		return room, nil
	}

	// Check if a player with the same name already exists (reconnecting)
	var existingPlayerID string
	for id, p := range room.Players {
		if p.Name == name {
			existingPlayerID = id
			break
		}
	}

	if existingPlayerID != "" {
		// Player is reconnecting - update their ID but keep their data
		oldPlayer := room.Players[existingPlayerID]
		delete(room.Players, existingPlayerID)
		
		// Create new entry with updated ID
		room.Players[playerID] = &Player{
			ID:     playerID,
			Name:   oldPlayer.Name,
			Avatar: oldPlayer.Avatar,
			IsHost: oldPlayer.IsHost,
			Score:  oldPlayer.Score,
		}
		
		// Update turn order to use new ID
		for i, id := range room.TurnOrder {
			if id == existingPlayerID {
				room.TurnOrder[i] = playerID
				break
			}
		}
		
		// If this player was the host, update room.HostID to new ID
		if oldPlayer.IsHost {
			room.HostID = playerID
		}
		
		fmt.Printf("Player %s reconnected with new ID: %s -> %s (host: %v)\n", name, existingPlayerID, playerID, oldPlayer.IsHost)
	} else {
		// New player joining
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

func (rm *RoomManager) Lock() {
	rm.mu.Lock()
}

func (rm *RoomManager) Unlock() {
	rm.mu.Unlock()
}