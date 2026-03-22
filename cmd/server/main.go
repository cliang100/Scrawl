package main

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"scrawl/internal/hub"
	"scrawl/internal/game"
	"github.com/gorilla/websocket"
)

func main() {
	r := gin.Default()
	r.Static("/static", "./web/static")
	r.LoadHTMLGlob("web/templates/*")

	r.GET("/", func(c *gin.Context) {
		c.HTML(200, "lobby.html", nil)
	})
	
	r.GET("/game", func(c *gin.Context) {
		c.HTML(200, "game.html", nil)
	})

	var upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}

	var hubInstance = hub.NewHub()

	roomManager := game.NewRoomManager()

	r.GET("/ws", func(c *gin.Context) {
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "WebSocket upgrade failed"})
			return
		}

		hub.HandleClient(conn, hubInstance, "lobby", roomManager)
	})

	r.GET("/ws/:roomId", func(c *gin.Context) {
		roomID := c.Param("roomId")
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "WebSocket upgrade failed"})
			return
		}

		hub.HandleClient(conn, hubInstance, roomID, roomManager)
	})

	go hub.Run(hubInstance)

	r.Run(":8080")
}