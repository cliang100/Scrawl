package game

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	mathrand "math/rand/v2"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	maxPlayers     = 8
	maxGuessLength = 100
	wordSelectTime = 15 * time.Second
	reconnectGrace = 20 * time.Second
)

type state string

const (
	stateLobby    state = "lobby"
	stateChoosing state = "choosing"
	stateDrawing  state = "drawing"
)

var (
	errRoomFull  = errors.New("room is full")
	errNameTaken = errors.New("that name is taken in this room")
)

// Room is one game. Every field is guarded by mu, and timers take it too.
type Room struct {
	Code string

	mu       sync.Mutex
	onEmpty  func()
	closed   bool
	players  []*Player // join order, which is also turn order
	settings Settings

	state    state
	round    int
	turn     int // index into players of the current drawer
	word     string
	choices  []string
	revealed map[int]bool
	canvas   []canvasOp
	deadline time.Time
	phaseID  int // bumped on every phase change so stale timers do nothing
}

func newRoom(code string, onEmpty func()) *Room {
	return &Room{
		Code:     code,
		onEmpty:  onEmpty,
		settings: Settings{Rounds: 3, DrawTime: 80},
		state:    stateLobby,
	}
}

// Join adds a player, or reattaches one who presents their token.
func (r *Room) Join(name, avatar, token string, conn Conn) (*Player, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil, ErrRoomNotFound
	}

	if p := r.byToken(token); p != nil {
		if p.conn != nil && p.conn != conn {
			p.conn.Close()
		}
		p.conn = conn
		p.dropped++
		r.welcome(p, "roomJoined")
		return p, nil
	}

	name, avatar, err := cleanProfile(name, avatar)
	if err != nil {
		return nil, err
	}
	if len(r.players) >= maxPlayers {
		return nil, errRoomFull
	}
	for _, p := range r.players {
		if strings.EqualFold(p.Name, name) {
			return nil, errNameTaken
		}
	}

	p := &Player{
		ID:     rand.Text(),
		Name:   name,
		Avatar: avatar,
		IsHost: len(r.players) == 0,
		token:  rand.Text(),
		conn:   conn,
	}
	r.players = append(r.players, p)
	kind := "roomJoined"
	if p.IsHost {
		kind = "roomCreated"
	}
	r.welcome(p, kind)
	r.broadcastRoom()
	return p, nil
}

func (r *Room) byToken(token string) *Player {
	if token == "" {
		return nil
	}
	for _, p := range r.players {
		if subtle.ConstantTimeCompare([]byte(p.token), []byte(token)) == 1 {
			return p
		}
	}
	return nil
}

// Disconnect starts the grace period, unless the player already has a newer connection.
func (r *Room) Disconnect(p *Player, conn Conn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if p.conn != conn {
		return
	}
	p.conn = nil
	p.dropped++
	dropped := p.dropped
	if r.state == stateDrawing && r.allGuessed() {
		r.endTurn(false)
	}
	time.AfterFunc(reconnectGrace, func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if p.dropped == dropped {
			r.remove(p)
		}
	})
}

func (r *Room) remove(p *Player) {
	i := slices.Index(r.players, p)
	if i < 0 {
		return
	}
	r.players = slices.Delete(r.players, i, i+1)
	if len(r.players) == 0 {
		r.closed = true
		r.phaseID++
		r.onEmpty()
		return
	}
	if p.IsHost {
		r.players[0].IsHost = true
	}
	r.broadcastRoom()

	if r.state == stateLobby {
		return
	}
	if len(r.players) < 2 {
		r.gameOver()
		return
	}
	switch {
	case i < r.turn:
		r.turn--
	case i == r.turn:
		// the next player has moved into the drawer's slot
		r.turn--
		r.endTurn(true)
		return
	}
	if r.state == stateDrawing && r.allGuessed() {
		r.endTurn(false)
	}
}

// Handle processes one message from a player.
func (r *Room) Handle(p *Player, conn Conn, msg Incoming) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if p.conn != conn {
		return
	}

	switch msg.Type {
	case "updateSettings":
		var s Settings
		if r.state != stateLobby || !p.IsHost || json.Unmarshal(msg.Data, &s) != nil || !s.valid() {
			return
		}
		r.settings = s
		r.broadcast("settingsUpdated", s)
	case "startGame":
		r.start(p)
	case "selectWord":
		var d struct {
			Word string `json:"word"`
		}
		if r.state == stateChoosing && p == r.drawer() && json.Unmarshal(msg.Data, &d) == nil && slices.Contains(r.choices, d.Word) {
			r.beginDrawing(d.Word)
		}
	case "guess":
		var d struct {
			Guess string `json:"guess"`
		}
		if json.Unmarshal(msg.Data, &d) == nil {
			r.chat(p, strings.TrimSpace(d.Guess))
		}
	case "stroke", "fill":
		op, ok := parseCanvasOp(msg.Type, msg.Data)
		if ok && r.canDraw(p) && len(r.canvas) < maxCanvasOps {
			r.canvas = append(r.canvas, op)
			r.broadcastExcept(p, msg.Type, op)
		}
	case "undoStroke":
		if r.canDraw(p) {
			r.canvas = undo(r.canvas)
			r.broadcastExcept(p, "undoStroke", data{})
		}
	case "clearCanvas":
		if r.canDraw(p) {
			r.canvas = nil
			r.broadcastExcept(p, "clearCanvas", data{})
		}
	}
}

func (r *Room) canDraw(p *Player) bool {
	return r.state == stateDrawing && p == r.drawer()
}

func (r *Room) drawer() *Player {
	return r.players[r.turn]
}

func (r *Room) start(p *Player) {
	if r.state != stateLobby {
		return
	}
	if !p.IsHost {
		p.send("gameError", data{"error": "Only the host can start the game"})
		return
	}
	if len(r.players) < 2 {
		p.send("gameError", data{"error": "Need at least 2 players to start"})
		return
	}
	mathrand.Shuffle(len(r.players), func(i, j int) {
		r.players[i], r.players[j] = r.players[j], r.players[i]
	})
	for _, q := range r.players {
		q.Score = 0
	}
	r.round = 1
	r.turn = 0
	r.broadcast("gameStarted", data{
		"players":  r.players,
		"rounds":   r.settings.Rounds,
		"drawTime": r.settings.DrawTime,
	})
	r.beginChoosing()
}

func (r *Room) beginChoosing() {
	r.state = stateChoosing
	r.word = ""
	r.canvas = nil
	r.revealed = make(map[int]bool)
	r.choices = pickWords(3)
	for _, p := range r.players {
		p.guessed = false
	}
	r.startPhase(wordSelectTime)
	r.after(wordSelectTime, func() { r.beginDrawing(r.choices[0]) })
	for _, p := range r.players {
		r.sendState(p)
	}
}

func (r *Room) beginDrawing(word string) {
	r.state = stateDrawing
	r.word = word
	drawTime := time.Duration(r.settings.DrawTime) * time.Second
	r.startPhase(drawTime)
	r.after(drawTime, func() { r.endTurn(true) })
	for _, delay := range hintDelays(word, drawTime) {
		r.after(delay, r.revealLetter)
	}
	r.broadcast("drawingNow", data{"drawerName": r.drawer().Name})
	for _, p := range r.players {
		r.sendState(p)
	}
}

func (r *Room) startPhase(d time.Duration) {
	r.phaseID++
	r.deadline = time.Now().Add(d)
}

// after runs fn with the lock held, unless the phase has changed by then.
func (r *Room) after(d time.Duration, fn func()) {
	id := r.phaseID
	time.AfterFunc(d, func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.phaseID == id {
			fn()
		}
	})
}

func (r *Room) revealLetter() {
	var hidden []int
	for i, c := range r.word {
		if c != ' ' && !r.revealed[i] {
			hidden = append(hidden, i)
		}
	}
	if len(hidden) == 0 {
		return
	}
	r.revealed[hidden[mathrand.IntN(len(hidden))]] = true
	r.broadcastExcept(r.drawer(), "hint", data{"mask": maskWord(r.word, r.revealed)})
}

func (r *Room) chat(p *Player, text string) {
	if text == "" || utf8.RuneCountInString(text) > maxGuessLength {
		return
	}
	if r.state != stateDrawing {
		r.broadcast("guess", data{"guess": text, "userName": p.Name, "isWinnerChat": false})
		return
	}
	if p == r.drawer() || p.guessed {
		r.winnerChat(p, text)
		return
	}
	if !strings.EqualFold(text, r.word) {
		r.broadcast("guess", data{"guess": text, "userName": p.Name, "isWinnerChat": false})
		return
	}

	p.guessed = true
	points := guessPoints(time.Until(r.deadline), time.Duration(r.settings.DrawTime)*time.Second)
	p.Score += points
	r.drawer().Score += points / 4
	r.broadcast("guess", data{"displayText": p.Name + " guessed the word!", "userName": p.Name})
	r.broadcastRoom()
	r.winnerChat(p, text)
	if r.allGuessed() {
		r.endTurn(false)
	}
}

func (r *Room) winnerChat(p *Player, text string) {
	for _, q := range r.players {
		if q.guessed || q == r.drawer() {
			q.send("guess", data{"guess": text, "userName": p.Name, "isWinnerChat": true})
		}
	}
}

// allGuessed ignores players who are disconnected.
func (r *Room) allGuessed() bool {
	guessed := 0
	for _, p := range r.players {
		if p == r.drawer() {
			continue
		}
		if p.guessed {
			guessed++
		} else if p.conn != nil {
			return false
		}
	}
	return guessed > 0
}

func (r *Room) endTurn(timedOut bool) {
	word := r.word
	r.turn++
	if r.turn >= len(r.players) {
		r.turn = 0
		r.round++
	}
	if r.round > r.settings.Rounds {
		r.gameOver()
		return
	}
	r.broadcast("turnEnd", data{"word": word, "timedOut": timedOut})
	r.beginChoosing()
}

func (r *Room) gameOver() {
	r.phaseID++
	r.state = stateLobby
	r.word = ""
	r.canvas = nil
	ranked := slices.Clone(r.players)
	slices.SortStableFunc(ranked, func(a, b *Player) int { return b.Score - a.Score })
	r.broadcast("gameOver", data{"scores": ranked})
}

func (r *Room) welcome(p *Player, kind string) {
	p.send(kind, data{
		"roomCode": r.Code,
		"playerId": p.ID,
		"token":    p.token,
		"players":  r.players,
		"settings": r.settings,
	})
	if r.state != stateLobby {
		r.sendState(p)
	}
}

func (r *Room) sendState(p *Player) {
	d := data{
		"state":           r.state,
		"currentDrawerId": r.drawer().ID,
		"players":         r.players,
		"round":           r.round,
		"maxRounds":       r.settings.Rounds,
		"remainingMs":     max(time.Until(r.deadline).Milliseconds(), 0),
		"mask":            maskWord(r.word, r.revealed),
		"guessed":         p.guessed,
		"canvas":          r.canvas,
	}
	if p == r.drawer() {
		if r.state == stateChoosing {
			d["choices"] = r.choices
		} else {
			d["word"] = r.word
		}
	}
	p.send("gameStateUpdate", d)
}

func (r *Room) broadcastRoom() {
	r.broadcast("roomUpdated", data{"players": r.players})
}

func (r *Room) broadcast(kind string, d any) {
	r.broadcastExcept(nil, kind, d)
}

func (r *Room) broadcastExcept(skip *Player, kind string, d any) {
	for _, p := range r.players {
		if p != skip {
			p.send(kind, d)
		}
	}
}

func (p *Player) send(kind string, d any) {
	if p.conn != nil {
		p.conn.Send(Message{Type: kind, Data: d})
	}
}
