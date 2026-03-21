package hub

import (
	"encoding/json"
	"log"
	"scrawl/internal/models"
	"github.com/gorilla/websocket"
	"github.com/google/uuid"
)

func HandleClient(ws *websocket.Conn, hub *models.Hub, roomID string) {
	client := &models.Client{
		ID:		uuid.New().String(),
		RoomID:	roomID,
		Conn:	ws,
		Send:	make(chan models.Message, 256),
	}

	hub.Register <- client

	go writePump(client)
	go readPump(client, hub)
}

func readPump(c *models.Client, hub *models.Hub) {
	defer func() {
		c.Conn.Close()
	}()

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			break
		}

		var msg models.Message
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("Error unmarshaling message: %v", err)
			continue
		}

		msg.UserID = c.ID
		msg.RoomID = c.RoomID
		hub.Broadcast <- msg
	}
}

func writePump(c *models.Client) {
	defer func() {
		c.Conn.Close()
	}()

	for message := range c.Send {
		data, err := json.Marshal(message)
		if err != nil {
			log.Printf("Error marshaling: %v", err)
			continue
		}

		err = c.Conn.WriteMessage(websocket.TextMessage, data)
		if err != nil {
			break
		}
	}
}