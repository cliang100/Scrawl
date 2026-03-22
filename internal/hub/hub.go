package hub

import (
	"log"
	"scrawl/internal/models"
)

func NewHub() *models.Hub {
	return &models.Hub{
		Clients:	make(map[*models.Client]bool),
		Rooms:		make(map[string]map[*models.Client]bool),
		Register:	make(chan *models.Client),
		Unregister: make(chan *models.Client),
		Broadcast: 	make(chan models.Message),
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
			if roomClients, ok := h.Rooms[message.RoomID]; ok {
				for client := range roomClients {
					select {
					case client.Send <- message:
					default:
						close(client.Send)
						delete(h.Clients, client)
						delete(h.Rooms[client.RoomID], client)
					}
				}
			}
		}
	}
}

func SwitchRoom(h *models.Hub, client *models.Client, newRoomID string) {
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

	log.Printf("Client %s switched from room %s to %s", client.ID, client.RoomID, newRoomID)
}