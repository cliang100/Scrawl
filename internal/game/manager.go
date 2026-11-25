package game

import (
	"crypto/rand"
	"errors"
	"math/big"
	"sync"
)

const maxRooms = 500

var (
	ErrRoomNotFound = errors.New("room not found")
	ErrServerFull   = errors.New("server is full, try again later")
)

// Manager owns the set of open rooms.
type Manager struct {
	mu    sync.Mutex
	rooms map[string]*Room
}

func NewManager() *Manager {
	return &Manager{rooms: make(map[string]*Room)}
}

func (m *Manager) Create(name, avatar string, conn Conn) (*Room, *Player, error) {
	name, avatar, err := cleanProfile(name, avatar)
	if err != nil {
		return nil, nil, err
	}

	m.mu.Lock()
	if len(m.rooms) >= maxRooms {
		m.mu.Unlock()
		return nil, nil, ErrServerFull
	}
	code := newCode()
	for m.rooms[code] != nil {
		code = newCode()
	}
	room := newRoom(code, func() { m.remove(code) })
	m.rooms[code] = room
	m.mu.Unlock()

	player, err := room.Join(name, avatar, "", conn)
	return room, player, err
}

func (m *Manager) Join(code, name, avatar, token string, conn Conn) (*Room, *Player, error) {
	m.mu.Lock()
	room := m.rooms[code]
	m.mu.Unlock()
	if room == nil {
		return nil, nil, ErrRoomNotFound
	}
	player, err := room.Join(name, avatar, token, conn)
	return room, player, err
}

func (m *Manager) remove(code string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.rooms, code)
}

func newCode() string {
	const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	code := make([]byte, 6)
	for i := range code {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			panic(err) // crypto/rand never fails on supported platforms
		}
		code[i] = charset[n.Int64()]
	}
	return string(code)
}
