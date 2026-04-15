package hub

import (
	"encoding/json"
	"log"
	"math/rand"
	"strings"
	"time"
	"scrawl/internal/models"
	"scrawl/internal/words"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

func startWordSelectionTimer(hub *models.Hub, roomManager *models.RoomManager, roomCode string, drawerID string, words []string) {
	room := roomManager.Rooms[roomCode]
	if room == nil {
		return
	}
	log.Printf(">>> startWordSelectionTimer called for room %s at %v", roomCode, time.Now())

	roomManager.Lock()
	if room.CancelTimer != nil {
		close(room.CancelTimer)
		room.CancelTimer = nil
	}
	room.CancelTimer = make(chan struct{})
	cancelChan := room.CancelTimer
	room.TimerGeneration++
	myGeneration := room.TimerGeneration
	roomManager.Unlock()

	deadline := time.Now().Add(15 * time.Second)
	room.TimerDeadline = deadline

	hub.Broadcast <- models.Message{
		Type: "timerStart",
		Data: map[string]interface{}{
			"duration": 15,
			"phase":    "wordSelection",
			"deadline": deadline.Unix(),
		},
		RoomID: roomCode,
	}

	hub.Mu.RLock()
	if roomClients, ok := hub.Rooms[roomCode]; ok {
		for client := range roomClients {
			if client.ID == drawerID {
				shuffled := make([]string, len(words))
				copy(shuffled, words)
				for i := len(shuffled) - 1; i > 1; i-- {
					j := rand.Intn(i + 1)
					shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
				}
				client.Send <- models.Message{
					Type: "getWords",
					Data: map[string]interface{}{
						"words": shuffled[:3],
					},
					UserID: client.ID,
					RoomID: roomCode,
				}
				break
			}
		}
	}
	hub.Mu.RUnlock()
	log.Printf(">>> TIMER STARTED: 15s word selection for room %s at %v", roomCode, time.Now())
	go func() {
		timer := time.NewTimer(15 * time.Second)
		select {
		case <-timer.C:
			room := roomManager.Rooms[roomCode]
			if room == nil || room.CurrentWord != "" || room.TimerGeneration != myGeneration {
				return
			}
			shuffled := make([]string, len(words))
			copy(shuffled, words)
			for i := len(shuffled) - 1; i > 1; i-- {
				j := rand.Intn(i + 1)
				shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
			}
			room.CurrentWord = shuffled[0]

			hub.Broadcast <- models.Message{
				Type: "wordSelected",
				Data: map[string]interface{}{
					"word":     room.CurrentWord,
					"drawerID": drawerID,
				},
				RoomID: roomCode,
			}

			room.CancelTimer = make(chan struct{})
			drawCancelChan := room.CancelTimer

			go func() {
				timer := time.NewTimer(80 * time.Second)
				deadline := time.Now().Add(80 * time.Second)
				room.TimerDeadline = deadline

				hub.Broadcast <- models.Message{
					Type: "timerStart",
					Data: map[string]interface{}{
						"duration": 80,
						"deadline": deadline.Unix(),
					},
					RoomID: roomCode,
				}
				select {
				case <-timer.C:
					log.Printf("Drawing timer expired for room %s, advancing turn", roomCode)

					roomManager.Lock()
					room.CurrentWord = ""

					currentIdx := -1
					for i, id := range room.TurnOrder {
						if id == room.CurrentDrawerID {
							currentIdx = i
							break
						}
					}
					if currentIdx != -1 && len(room.TurnOrder) > 0 {
						nextIdx := (currentIdx + 1) % len(room.TurnOrder)
						room.CurrentDrawerID = room.TurnOrder[nextIdx]
					}
					roomManager.Unlock()

					hub.Broadcast <- models.Message{
						Type: "turnEnd",
						Data: map[string]interface{}{
							"timedOut":		true,
							"nextDrawer":	room.CurrentDrawerID,
						},
						RoomID: roomCode,
					}
					startWordSelectionTimer(hub, roomManager, roomCode, room.CurrentDrawerID, words)
					return
				case <-drawCancelChan:
					timer.Stop()
				}
			}()
		case <-cancelChan:
			timer.Stop()
		}
	}()
}

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
		log.Printf("readPump exiting for client %s", c.ID)
		hub.Unregister <- c
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
			log.Printf("startGame received - roomCode: %s, clientID: %s, playerCount: %d", roomCode, c.ID, len(room.Players))

			if len(room.Players) < 2 {
				c.Send <- models.Message{
					Type: "gameError",
					Data: map[string]interface{}{"error": "Need at least 2 players to start"},
				}
				continue
			}

			if room.HostID != c.ID {
				c.Send <- models.Message{
					Type: "gameError",
					Data: map[string]interface{}{"error": "Only the host can start the game"},
				}
				continue
			}
			
			room.State = "playing"
			room.MaxRounds = 3
			room.TurnCount = 0
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
			
			hub.Mu.RLock()
			if roomClients, ok := hub.Rooms[roomCode]; ok {
				for client := range roomClients {
					if client.ID == room.CurrentDrawerID {
						shuffled := make([]string,len(words.DrawingWords))
						copy(shuffled, words.DrawingWords)
						for i := len(shuffled) - 1; i > 1; i -- {
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
			hub.Mu.RUnlock()

			startWordSelectionTimer(hub, roomManager, room.Code, room.CurrentDrawerID, words.DrawingWords)

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
			if room.CurrentDrawerID != c.ID {
				continue
			}

			roomManager.Lock()
			if room.CancelTimer != nil {
				close(room.CancelTimer)
				room.CancelTimer = nil
			}
			room.CurrentWord = word
			cancelChan := make(chan struct{})
			room.CancelTimer = cancelChan
			roomManager.Unlock()

			roomManager.Lock()
			room.TimerGeneration++
			myGeneration := room.TimerGeneration
			roomManager.Unlock()

			go func() {
				log.Printf(">>> TIMER STARTED: 80s drawing for room %s at %v", c.RoomID, time.Now())
				timer := time.NewTimer(80 * time.Second)
				deadline := time.Now().Add(80 * time.Second)
				room.TimerDeadline = deadline

				hub.Broadcast <- models.Message{
					Type: "timerStart",
					Data: map[string]interface{}{
						"duration": 80,
						"deadline": deadline.Unix(),
					},
					RoomID: c.RoomID,
				}

				select {
					case <-timer.C:
						log.Printf("Timer expired for room %s", c.RoomID)
						room := roomManager.Rooms[c.RoomID]
						if room == nil || room.State != "playing" || room.TimerGeneration != myGeneration {
							return
						}

						room.CurrentWord = ""
						room.TurnCount++

						if room.TurnCount >= len(room.TurnOrder) {
							room.Round++
							room.TurnCount = 0
						}

						if room.Round > room.MaxRounds {
							room.State = "finished"
							hub.Broadcast <- models.Message{
								Type: "gameOver",
								Data: map[string]interface{}{
									"message": "Game over!",
								},
								RoomID: c.RoomID,
							}
							return
						}
						
						currentIndex := 0
						for i, id := range room.TurnOrder {
							if id == room.CurrentDrawerID {
								currentIndex = i
								break
							}
						}
						nextIndex := (currentIndex + 1) % len(room.TurnOrder)
						room.CurrentDrawerID = room.TurnOrder[nextIndex]

						hub.Broadcast <- models.Message{
							Type: "turnEnd",
							Data: map[string]interface{}{
								"correctGuesser": "",
								"guesserName":	  "",
								"nextDrawerId":	  room.CurrentDrawerID,
								"round":		  room.Round,
								"maxRounds":	  room.MaxRounds,
								"timedOut":		  true,
							},
							RoomID: c.RoomID,
						}

						hub.Mu.RLock()
						if roomClients, ok := hub.Rooms[c.RoomID]; ok {
							for client := range roomClients {
								if client.ID == room.CurrentDrawerID {
									shuffled := make([]string, len(words.DrawingWords))
									copy(shuffled, words.DrawingWords)
									for i := len(shuffled) - 1; i > 1; i -- {
										j := rand.Intn(i + 1)
										shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
									}
									client.Send <- models.Message{
										Type: "getWords",
										Data: map[string]interface{}{
											"words": shuffled[:3],
										},
										UserID: client.ID,
										RoomID: c.RoomID,
									}
									break
								}
							}
						}
						hub.Mu.RUnlock()
						
						startWordSelectionTimer(hub, roomManager, c.RoomID, room.CurrentDrawerID, words.DrawingWords)
					case <-cancelChan:
						timer.Stop()
						log.Printf("Timer cancelled for room %s", c.RoomID)
				}
			}()

			response := models.Message{
				Type: "wordSelected",
				Data: map[string]interface{}{
					"word":     word,
					"drawerID": c.ID,
				},
				RoomID: c.RoomID,
			}
			hub.Broadcast <- response
			
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

			if room.CurrentDrawerID == c.ID && room.CurrentWord == "" && room.State == "playing" {
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

				startWordSelectionTimer(hub, roomManager, roomCode, room.CurrentDrawerID, words.DrawingWords)
			}
		case "guess":
			guess := msg.Data.(map[string]interface{})["guess"].(string)
			userName := msg.Data.(map[string]interface{})["userName"].(string)
			room := roomManager.Rooms[c.RoomID]

			if room == nil {
				continue
			}

			hub.Broadcast <- models.Message{
				Type: "guess",
				Data: map[string]interface{}{
					"guess":	guess,
					"userName": userName,
					"userId":	c.ID,
				},
				RoomID: c.RoomID,
			}

			if strings.EqualFold(guess, room.CurrentWord) {
				roomManager.Lock()
				if room.CancelTimer != nil {
					close(room.CancelTimer)
					room.CancelTimer = nil
				}		
				roomManager.Unlock()

				room.CurrentWord = ""

				room.TurnCount++

				if room.TurnCount >= len(room.TurnOrder) {
					room.Round++
					room.TurnCount = 0
				}

				if room.Round > room.MaxRounds {
					room.State = "finished"
					hub.Broadcast <- models.Message{
						Type: "gameOver",
						Data: map[string]interface{}{
							"message": "Game over!",
						},
						RoomID: c.RoomID,
					}
				} else {
					currentIndex := 0
					for i, id := range room.TurnOrder {
						if id == room.CurrentDrawerID {
							currentIndex = i
							break
						}
					}
					nextIndex := (currentIndex + 1) % len(room.TurnOrder)
					room.CurrentDrawerID = room.TurnOrder[nextIndex]

					hub.Broadcast <- models.Message{
						Type: "turnEnd",
						Data: map[string]interface{}{
							"correctGuesser": c.ID,
							"guesserName": 	  userName,
							"nextDrawerId":	  room.CurrentDrawerID,
							"round":		  room.Round,
							"maxRounds":	  room.MaxRounds,
						},
						RoomID: c.RoomID,
					}
					if roomClients, ok := hub.Rooms[c.RoomID]; ok {
						hub.Mu.RLock()
						for client := range roomClients {
							if client.ID == room.CurrentDrawerID {
								shuffled := make([]string, len(words.DrawingWords))
								copy(shuffled, words.DrawingWords)
								for i := len(shuffled) - 1; i > 1; i -- {
									j := rand.Intn(i + 1)
									shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
								}
								client.Send <- models.Message{
									Type: "getWords",
									Data: map[string]interface{}{
										"words": shuffled[:3],
									},
									UserID: client.ID,
									RoomID: c.RoomID,
								}
								break
							}
						}
						hub.Mu.RUnlock()
					}

					startWordSelectionTimer(hub, roomManager, c.RoomID, room.CurrentDrawerID, words.DrawingWords)
				}
			}
		case "clearCanvas":
			log.Printf("clearCanvas received from client %s", c.ID)
			msg.RoomID = c.RoomID
			msg.UserID = c.ID
			hub.Broadcast <- msg
		case "draw":
			msg.RoomID = c.RoomID
			msg.UserID = c.ID
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
			log.Printf("writePump error for client %s: %v", c.ID, err)
			break
		}
	}
}
