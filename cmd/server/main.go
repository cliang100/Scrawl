package main

import (
	"github.com/gin-gonic/gin"
	"net/http"

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

	r.GET("/ws", func(c * gin.Context) {
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "WebSocket upgrade failed"})
			return
		}
		defer conn.Close()

		for {
			messageType, message, err := conn.ReadMessage()
			if err != nil {
				break
			}
			conn.WriteMessage(messageType, message)
		}
	})

	r.Run(":8080")
}