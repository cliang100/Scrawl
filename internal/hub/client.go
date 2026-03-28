package hub

import (
	"encoding/json"
	"log"
	"math/rand"
	"scrawl/internal/models"
	"scrawl/internal/words"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

func HandleClient(ws *websocket.Conn, hub *models.Hub, roomID string, roomManager *models.RoomManager) {
	client := &models.Client{
		ID:     uuid.New().String(),
		RoomID: roomID,
		Conn:   ws,
		Send:   make(chan models.Message, 256),
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
			name := msg.Data.(map[string]interface{})["name"].(string)
			avatar := msg.Data.(map[string]interface{})["avatar"].(string)
			room := roomManager.CreateRoom(c.ID, name, avatar)

			SwitchRoom(hub, c, room.Code)

			response := models.Message{
				Type: "roomCreated",
				Data: map[string]interface{}{
					"roomCode": room.Code,
					"players":  room.Players,
					"hostId":   room.HostID,
				},
				UserID: c.ID,
				RoomID: room.Code,
			}
			c.Send <- response

		case "joinRoom":
			roomCode := msg.Data.(map[string]interface{})["roomCode"].(string)
			name := msg.Data.(map[string]interface{})["name"].(string)
			avatar := msg.Data.(map[string]interface{})["avatar"].(string)
			room, err := roomManager.JoinRoom(roomCode, c.ID, name, avatar)
			if err != nil {
				response := models.Message{
					Type:   "roomError",
					Data:   map[string]interface{}{"error": err.Error()},
					UserID: c.ID,
				}
				c.Send <- response
			} else {
				SwitchRoom(hub, c, room.Code)

				response := models.Message{
					Type: "roomUpdated",
					Data: map[string]interface{}{
						"roomCode": room.Code,
						"players":  room.Players,
						"hostId":   room.HostID,
					},
					RoomID: room.Code,
				}

				hub.Broadcast <- response

				joinResponse := models.Message{
					Type: "roomJoined",
					Data: map[string]interface{}{
						"roomCode": room.Code,
						"players":  room.Players,
						"hostId":   room.HostID,
					},
					UserID: c.ID,
					RoomID: room.Code,
				}
				c.Send <- joinResponse
			}
		case "startGame":
			roomCode := msg.Data.(map[string]interface{})["roomCode"].(string)
			room := roomManager.Rooms[roomCode]

			if room.HostID != c.ID {
				c.Send <- models.Message{
					Type: "gameError",
					Data: map[string]interface{}{"error": "Only the host can start the game"},
				}
				return
			}
			
			room.State = "playing"
			room.CurrentDrawerID = room.TurnOrder[0]

			hub.Broadcast <- models.Message{
				Type: "gameStarted",
				Data: map[string]interface{}{
					"roomCode":			room.Code,
					"players":			room.Players,
					"hostId":			room.HostID,
					"state":			room.State,
					"currentDrawerId":	room.CurrentDrawerID,
					"turnOrder":		room.TurnOrder,
				},
				RoomID: room.Code,
			}

			if roomClients, ok := hub.Rooms[room.Code]; ok {
				for client := range roomClients {
					if client.ID == room.CurrentDrawerID {
						shuffled := make([]string, len(words.DrawingWords))
						copy(shuffled, words.DrawingWords)
						for i := len(shuffled) - 1; i > 0; i -- {
							j := rand.Intn(i + 1)
							shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
						}
						client.Send <- models.Message{
							Type: "getWords",
							Data: map[string]interface{}{
								"words": shuffled[:3],
							},
							UserID: client.ID,
							RoomID: room.Code,
						}
						break
					}
				}
			}
		case "getWords":
			words := words.DrawingWords
			shuffled := make([]string, len(words))
			copy(shuffled, words)

			for i := len(shuffled) - 1; i > 1; i-- {
				j := rand.Intn(i + 1)
				shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
			}

			selectedWords := shuffled[:3]

			response := models.Message{
				Type: "getWords",
				Data: map[string]interface{}{
					"words": selectedWords,
				},
				UserID: c.ID,
				RoomID: c.RoomID,
			}
			c.Send <- response
		case "selectWord":
			word := msg.Data.(map[string]interface{})["word"].(string)
			room := roomManager.Rooms[c.RoomID]
			if room.CurrentDrawerID == c.ID {
				room.CurrentWord = word

				response := models.Message{
					Type: "wordSelected",
					Data: map[string]interface{}{
						"word":     word,
						"drawerID": c.ID,
					},
					RoomID: c.RoomID,
				}
				hub.Broadcast <- response
			}
		case "getGameState":
			roomCode := msg.Data.(map[string]interface{})["roomCode"].(string)
			playerName, _ := msg.Data.(map[string]interface{})["playerName"].(string)
			room := roomManager.Rooms[roomCode]
			log.Printf("getGameState received - roomCode: %s, playerName: %s, clientID %s", roomCode, playerName, c.ID)

			if room == nil {
				log.Printf("Room %s not found", roomCode)
				c.Send <- models.Message{
					Type: "gameError",
					Data: map[string]interface{}{"error": "Room not found"},
				}
				return
			}
			for oldID, player := range room.Players {
				if player.Name == playerName {
					room.Players[c.ID] = player
					delete(room.Players, oldID)

					for i, id := range room.TurnOrder {
						if id == oldID {
							room.TurnOrder[i] = c.ID
							break
						}
					}

					if room.CurrentDrawerID == oldID {
						room.CurrentDrawerID = c.ID
					}

					if room.HostID == oldID {
						room.HostID = c.ID
					}

					log.Printf("Reassigned player %s from %s to %s", playerName, oldID, c.ID)
					break
				}
			}

			response := models.Message{
				Type: "gameStateUpdate",
				Data: map[string]interface{}{
					"currentDrawerId": room.CurrentDrawerID,
					"turnOrder":       room.TurnOrder,
					"players":         room.Players,
					"currentWord":     room.CurrentWord,
				},
				UserID: c.ID,
				RoomID: roomCode,
			}
			c.Send <- response

			if room.CurrentDrawerID == c.ID && room.CurrentWord == "" {
				shuffled := make([]string, len(words.DrawingWords))
				copy(shuffled, words.DrawingWords)
				for i := len(shuffled) - 1; i > 1; i-- {
					j := rand.Intn(i + 1)
					shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
				}
				c.Send <- models.Message{
					Type: "getWords",
					Data: map[string]interface{}{
						"words": shuffled[:3],
					},
					UserID: c.ID,
					RoomID: roomCode,
				}
			}
		case "draw":
			msg.RoomID = c.RoomID
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
