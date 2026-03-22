package hub

import (
	"encoding/json"
	"log"
	"scrawl/internal/models"
	"github.com/gorilla/websocket"
	"github.com/google/uuid"
)

func HandleClient(ws *websocket.Conn, hub *models.Hub, roomID string, roomManager *models.RoomManager) {
	client := &models.Client{
		ID:		uuid.New().String(),
		RoomID:	roomID,
		Conn:	ws,
		Send:	make(chan models.Message, 256),
	}

	hub.Register <- client

	go writePump(client)
	go readPump(client, hub, roomManager)
}

func readPump(c *models.Client, hub *models.Hub, roomManager *models.RoomManager) {
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
		
		switch msg.Type {
        case "createRoom":
            room := roomManager.CreateRoom(c.ID)

			SwitchRoom(hub, c, room.Code)

			response := models.Message{
				Type: "roomCreated",
				Data: map[string]interface{}{
					"roomCode": 	room.Code,
					"players": 		room.Players,
					"hostId":		room.HostID,
				},
				UserID: c.ID,
				RoomID: room.Code,
			}
			c.Send <- response

        case "joinRoom":
            roomCode := msg.Data.(map[string]interface{})["roomCode"].(string)
			room, err := roomManager.JoinRoom(roomCode, c.ID)
			if err != nil {
				response := models.Message{
					Type: "roomError",
					Data: map[string]interface{}{"error": err.Error()},
					UserID: c.ID,
				}
				c.Send <- response
			} else {
				SwitchRoom(hub, c, room.Code)
				
				response := models.Message{
					Type: "roomUpdated",
					Data: map[string]interface{}{
						"roomCode": room.Code,
						"players":	room.Players,
						"hostId":	room.HostID,
					},
					RoomID: room.Code,
				}

				hub.Broadcast <- response

				joinResponse := models.Message{
					Type: "roomJoined",
					Data: map[string]interface{}{
						"roomCode": room.Code,
						"players":	room.Players,
						"hostId":	room.HostID,
					},
					UserID: c.ID,
					RoomID: room.Code,
				}
				c.Send <- joinResponse
			} 
        case "startGame":
            // Handle game start
        case "draw":
            hub.Broadcast <- msg
        default:
            hub.Broadcast <- msg
        }
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