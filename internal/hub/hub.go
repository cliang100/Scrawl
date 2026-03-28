package hub

import (
	"log"
	"scrawl/internal/models"
)

func NewHub() *models.Hub {
	return &models.Hub{
		Clients:    make(map[*models.Client]bool),
		Rooms:      make(map[string]map[*models.Client]bool),
		Register:   make(chan *models.Client, 256),
		Unregister: make(chan *models.Client, 256),
		Broadcast:  make(chan models.Message, 256),
	}
}

func Run(h *models.Hub) {
	for {
		select {
		case client := <-h.Register:
			h.Clients[client] = true
			if h.Rooms[client.RoomID] == nil {
				h.Rooms[client.RoomID] = make(map[*models.Client]bool)
			}
			h.Rooms[client.RoomID][client] = true
			log.Printf("Client %s joined room %s", client.ID, client.RoomID)

		case client := <-h.Unregister:
			if _, ok := h.Clients[client]; ok {
				delete(h.Clients, client)
				delete(h.Rooms[client.RoomID], client)
				close(client.Send)
				log.Printf("Client %s left room %s", client.ID, client.RoomID)
			}
		case message := <-h.Broadcast:
			h.Mu.RLock()
			roomClients := h.Rooms[message.RoomID]
			h.Mu.RUnlock()
			for client := range roomClients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					h.Mu.Lock()
					delete(h.Clients, client)
					delete(h.Rooms[client.RoomID], client)
					h.Mu.Unlock()
				}
			}
		}
	}
}

func SwitchRoom(h *models.Hub, client *models.Client, newRoomID string) {
	h.Mu.Lock()
	defer h.Mu.Unlock()

	if oldRoomClients, exists := h.Rooms[client.RoomID]; exists {
		delete(oldRoomClients, client)
		if len(oldRoomClients) == 0 {
			delete(h.Rooms, client.RoomID)
		}
	}

	client.RoomID = newRoomID
	if h.Rooms[newRoomID] == nil {
		h.Rooms[newRoomID] = make(map[*models.Client]bool)
	}
	h.Rooms[newRoomID][client] = true
	log.Printf("Client %s switched to %s", client.ID, newRoomID)
}
