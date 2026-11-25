package server

import (
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"scrawl/internal/game"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

const csp = "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
	"font-src https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

var roomCodePattern = regexp.MustCompile(`^[A-Z0-9]{6}$`)

// New builds the router. allowedOrigins lists other sites that may open a WebSocket.
func New(webDir string, allowedOrigins []string) http.Handler {
	manager := game.NewManager()
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return originAllowed(r, allowedOrigins) },
	}

	r := gin.New()
	r.Use(gin.Recovery(), func(c *gin.Context) {
		c.Header("Content-Security-Policy", csp)
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
	})
	r.Static("/static", filepath.Join(webDir, "static"))
	r.StaticFile("/", filepath.Join(webDir, "index.html"))
	r.GET("/healthz", func(c *gin.Context) { c.String(http.StatusOK, "ok") })
	r.GET("/ws", func(c *gin.Context) {
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return // Upgrade has already replied
		}
		cl := &client{
			conn:    conn,
			manager: manager,
			send:    make(chan []byte, sendBuffer),
			done:    make(chan struct{}),
		}
		go cl.writePump()
		go cl.readPump()
	})
	r.GET("/:roomCode", func(c *gin.Context) {
		if !roomCodePattern.MatchString(c.Param("roomCode")) {
			c.Status(http.StatusNotFound)
			return
		}
		c.File(filepath.Join(webDir, "game.html"))
	})
	return r
}

func originAllowed(r *http.Request, allowed []string) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // not a browser
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, r.Host) || slices.Contains(allowed, origin)
}
