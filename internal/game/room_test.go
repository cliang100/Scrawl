package game

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

type sent struct {
	Type string
	Data map[string]any
}

type fakeConn struct {
	mu     sync.Mutex
	msgs   []sent
	closed bool
}

func (c *fakeConn) Send(m Message) {
	raw, err := json.Marshal(m)
	if err != nil {
		panic(err)
	}
	var s sent
	if err := json.Unmarshal(raw, &s); err != nil {
		panic(err)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.msgs = append(c.msgs, s)
}

func (c *fakeConn) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
}

func (c *fakeConn) all(kind string) []sent {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []sent
	for _, m := range c.msgs {
		if m.Type == kind {
			out = append(out, m)
		}
	}
	return out
}

func (c *fakeConn) last(t *testing.T, kind string) map[string]any {
	t.Helper()
	all := c.all(kind)
	if len(all) == 0 {
		t.Fatalf("no %q message", kind)
	}
	return all[len(all)-1].Data
}

type seat struct {
	p    *Player
	conn *fakeConn
}

func setup(t *testing.T, n int) (*Manager, *Room, []seat) {
	t.Helper()
	m := NewManager()
	var room *Room
	var seats []seat
	for i := range n {
		c := &fakeConn{}
		name := fmt.Sprintf("player%d", i)
		var p *Player
		var err error
		if i == 0 {
			room, p, err = m.Create(name, "🎨", c)
		} else {
			_, p, err = m.Join(room.Code, name, "🦊", "", c)
		}
		if err != nil {
			t.Fatal(err)
		}
		seats = append(seats, seat{p, c})
	}
	return m, room, seats
}

func (s seat) do(r *Room, kind string, d any) {
	raw, _ := json.Marshal(d)
	r.Handle(s.p, s.conn, Incoming{Type: kind, Data: raw})
}

// startDrawing starts a turn and returns the drawer and the guessers.
func startDrawing(t *testing.T, r *Room, seats []seat) (seat, []seat) {
	t.Helper()
	if r.state == stateLobby {
		seats[0].do(r, "startGame", nil)
	}
	var drawer seat
	var guessers []seat
	for _, s := range seats {
		if s.p == r.drawer() {
			drawer = s
		} else {
			guessers = append(guessers, s)
		}
	}
	drawer.do(r, "selectWord", data{"word": r.choices[0]})
	if r.state != stateDrawing {
		t.Fatalf("state = %s, want drawing", r.state)
	}
	return drawer, guessers
}

func TestJoinRules(t *testing.T) {
	m, room, _ := setup(t, 2)
	for _, tc := range []struct{ code, name, avatar string }{
		{"NOPE00", "valid", "🎨"},
		{room.Code, "x", "🎨"},
		{room.Code, "waytoolongname", "🎨"},
		{room.Code, "valid", "<img>"},
		{room.Code, "PLAYER1", "🎨"},
	} {
		if _, _, err := m.Join(tc.code, tc.name, tc.avatar, "", &fakeConn{}); err == nil {
			t.Errorf("join %+v should fail", tc)
		}
	}
	for i := 2; i < maxPlayers; i++ {
		if _, _, err := m.Join(room.Code, fmt.Sprintf("extra%d", i), "🎨", "", &fakeConn{}); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := m.Join(room.Code, "toomany", "🎨", "", &fakeConn{}); err != errRoomFull {
		t.Fatalf("err = %v, want room full", err)
	}
}

func TestReconnectNeedsToken(t *testing.T) {
	m, room, seats := setup(t, 2)
	if _, _, err := m.Join(room.Code, "player1", "🎨", "wrong", &fakeConn{}); err != errNameTaken {
		t.Fatalf("err = %v, want name taken", err)
	}
	c := &fakeConn{}
	_, p, err := m.Join(room.Code, "", "", seats[1].p.token, c)
	if err != nil || p != seats[1].p {
		t.Fatalf("p = %v, err = %v", p, err)
	}
	if !seats[1].conn.closed {
		t.Error("old connection should be closed")
	}
	room.Disconnect(p, seats[1].conn)
	if p.conn != Conn(c) {
		t.Error("old connection closing must not detach the new one")
	}
}

func TestTokensNeverBroadcast(t *testing.T) {
	_, room, seats := setup(t, 3)
	startDrawing(t, room, seats)
	for _, s := range seats {
		for _, other := range seats {
			raw, _ := json.Marshal(s.conn.msgs)
			if s.p != other.p && strings.Contains(string(raw), other.p.token) {
				t.Fatal("token leaked to another player")
			}
		}
	}
}

func TestHostOnlySettingsAndStart(t *testing.T) {
	_, room, seats := setup(t, 2)
	seats[1].do(room, "updateSettings", Settings{Rounds: 1, DrawTime: 30})
	seats[0].do(room, "updateSettings", Settings{Rounds: 99, DrawTime: 30})
	if room.settings != (Settings{Rounds: 3, DrawTime: 80}) {
		t.Fatalf("settings = %+v", room.settings)
	}
	seats[0].do(room, "updateSettings", Settings{Rounds: 1, DrawTime: 30})
	if room.settings != (Settings{Rounds: 1, DrawTime: 30}) {
		t.Fatalf("settings = %+v", room.settings)
	}
	seats[1].do(room, "startGame", nil)
	if room.state != stateLobby {
		t.Fatal("guest started the game")
	}
	seats[0].do(room, "startGame", nil)
	if room.state != stateChoosing {
		t.Fatal("host could not start")
	}
}

func TestSinglePlayerCannotStart(t *testing.T) {
	_, room, seats := setup(t, 1)
	seats[0].do(room, "startGame", nil)
	if room.state != stateLobby {
		t.Fatal("started alone")
	}
}

func TestDrawerMustPickOfferedWord(t *testing.T) {
	_, room, seats := setup(t, 2)
	seats[0].do(room, "startGame", nil)
	for _, s := range seats {
		s.do(room, "selectWord", data{"word": "not offered"})
	}
	if room.state != stateChoosing {
		t.Fatal("accepted a word that was not offered")
	}
}

func TestWordHiddenFromGuessers(t *testing.T) {
	_, room, seats := setup(t, 3)
	drawer, guessers := startDrawing(t, room, seats)
	if drawer.conn.last(t, "gameStateUpdate")["word"] != room.word {
		t.Error("drawer should see the word")
	}
	for _, g := range guessers {
		for _, s := range g.conn.all("gameStateUpdate") {
			if s.Data["word"] != nil || s.Data["choices"] != nil {
				t.Errorf("guesser saw %v", s.Data)
			}
		}
	}
}

func TestWinnerChatOnlyReachesWinners(t *testing.T) {
	_, room, seats := setup(t, 3)
	_, guessers := startDrawing(t, room, seats)
	guessers[0].do(room, "guess", data{"guess": strings.ToUpper(room.word)})
	guessers[0].do(room, "guess", data{"guess": "secret"})
	for _, m := range guessers[1].conn.all("guess") {
		if m.Data["isWinnerChat"] == true || m.Data["guess"] == "secret" {
			t.Fatalf("winner chat leaked: %v", m.Data)
		}
	}
}

func TestScoringAndTurnAdvance(t *testing.T) {
	_, room, seats := setup(t, 3)
	for turn := range 3 {
		drawer, guessers := startDrawing(t, room, seats)
		before := drawer.p.Score
		guessers[0].do(room, "guess", data{"guess": room.word})
		if room.state != stateDrawing {
			t.Fatalf("turn %d ended after one guess", turn)
		}
		if drawer.p.Score <= before || guessers[0].p.Score == 0 {
			t.Fatal("no points awarded")
		}
		again := guessers[0].p.Score
		guessers[0].do(room, "guess", data{"guess": room.word})
		if guessers[0].p.Score != again {
			t.Fatal("scored twice")
		}
		guessers[1].do(room, "guess", data{"guess": room.word})
		if room.state != stateChoosing {
			t.Fatalf("turn %d should end when all guessed", turn)
		}
	}
	if room.round != 2 {
		t.Fatalf("round = %d, want 2", room.round)
	}
}

func TestTimerStillEndsTurnAfterOneGuess(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		_, room, seats := setup(t, 3)
		_, guessers := startDrawing(t, room, seats)
		guessers[0].do(room, "guess", data{"guess": room.word})
		time.Sleep(80 * time.Second)
		synctest.Wait()
		if guessers[1].conn.last(t, "turnEnd")["timedOut"] != true {
			t.Fatal("turn did not time out")
		}
	})
}

func TestFullGameOnTimers(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		_, room, seats := setup(t, 2)
		seats[0].do(room, "updateSettings", Settings{Rounds: 2, DrawTime: 30})
		seats[0].do(room, "startGame", nil)
		time.Sleep(4 * 45 * time.Second)
		synctest.Wait()
		if len(seats[0].conn.all("turnEnd")) != 3 || len(seats[0].conn.all("gameOver")) != 1 {
			t.Fatalf("turnEnd = %d, gameOver = %d", len(seats[0].conn.all("turnEnd")), len(seats[0].conn.all("gameOver")))
		}
		seats[0].do(room, "startGame", nil)
		if room.state != stateChoosing {
			t.Fatal("could not start again")
		}
	})
}

func TestHintsRevealLetters(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		_, room, seats := setup(t, 2)
		drawer, guessers := startDrawing(t, room, seats)
		word := room.word
		time.Sleep(79 * time.Second)
		synctest.Wait()
		hints := guessers[0].conn.all("hint")
		if want := len(hintDelays(word, 80*time.Second)); len(hints) != want {
			t.Fatalf("hints = %d, want %d", len(hints), want)
		}
		if len(drawer.conn.all("hint")) != 0 {
			t.Fatal("drawer got a hint")
		}
	})
}

func TestDisconnectGrace(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		m, room, seats := setup(t, 3)
		room.Disconnect(seats[1].p, seats[1].conn)
		time.Sleep(reconnectGrace / 2)
		c := &fakeConn{}
		if _, _, err := m.Join(room.Code, "", "", seats[1].p.token, c); err != nil {
			t.Fatal(err)
		}
		time.Sleep(reconnectGrace)
		synctest.Wait()
		if len(room.players) != 3 {
			t.Fatal("returning player was removed")
		}

		room.Disconnect(seats[0].p, seats[0].conn)
		time.Sleep(reconnectGrace)
		synctest.Wait()
		if len(room.players) != 2 || !room.players[0].IsHost {
			t.Fatal("host was not replaced")
		}

		for _, p := range append([]*Player{}, room.players...) {
			room.Disconnect(p, p.conn)
		}
		time.Sleep(reconnectGrace)
		synctest.Wait()
		if len(m.rooms) != 0 {
			t.Fatal("empty room was not removed")
		}
	})
}

func TestDrawerLeavingAdvancesTurn(t *testing.T) {
	for _, position := range []int{0, 1, 2} {
		synctest.Test(t, func(t *testing.T) {
			_, room, seats := setup(t, 3)
			seats[0].do(room, "startGame", nil)
			room.mu.Lock()
			room.turn = position
			room.mu.Unlock()
			drawer := room.drawer()
			room.Disconnect(drawer, drawer.conn)
			time.Sleep(reconnectGrace)
			synctest.Wait()
			if len(room.players) != 2 || room.turn < 0 || room.turn >= 2 || room.state == stateLobby {
				t.Fatalf("players = %d, turn = %d, state = %s", len(room.players), room.turn, room.state)
			}
		})
	}
}

func TestGameEndsWhenOnePlayerLeft(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		_, room, seats := setup(t, 2)
		startDrawing(t, room, seats)
		room.Disconnect(seats[1].p, seats[1].conn)
		time.Sleep(reconnectGrace)
		synctest.Wait()
		seats[0].conn.last(t, "gameOver")
		if room.state != stateLobby {
			t.Fatal("game should be over")
		}
	})
}

func TestOnlyDrawerDraws(t *testing.T) {
	_, room, seats := setup(t, 2)
	drawer, guessers := startDrawing(t, room, seats)
	stroke := data{"strokeId": "a", "points": []point{{1, 2}}, "color": "#000000", "size": 5}
	guessers[0].do(room, "stroke", stroke)
	guessers[0].do(room, "clearCanvas", nil)
	if len(room.canvas) != 0 {
		t.Fatal("guesser drew")
	}
	drawer.do(room, "stroke", stroke)
	drawer.do(room, "stroke", stroke)
	drawer.do(room, "fill", data{"points": []point{{1, 2}}, "color": "#ff0000"})
	if len(room.canvas) != 3 || len(guessers[0].conn.all("stroke")) != 2 {
		t.Fatalf("canvas = %d", len(room.canvas))
	}
	drawer.do(room, "undoStroke", nil)
	if len(room.canvas) != 2 {
		t.Fatal("undo should drop the fill")
	}
	drawer.do(room, "undoStroke", nil)
	if len(room.canvas) != 0 {
		t.Fatal("undo should drop every batch of the stroke")
	}
}

func TestRejectsBadCanvasOps(t *testing.T) {
	for _, d := range []string{
		`null`, `[]`, `"x"`,
		`{"strokeId":"a","points":[],"color":"#000000","size":5}`,
		`{"strokeId":"a","points":[{"x":-1,"y":0}],"color":"#000000","size":5}`,
		`{"strokeId":"a","points":[{"x":1,"y":1}],"color":"red;","size":5}`,
		`{"strokeId":"a","points":[{"x":1,"y":1}],"color":"#000000","size":5000}`,
	} {
		if _, ok := parseCanvasOp("stroke", json.RawMessage(d)); ok {
			t.Errorf("accepted %s", d)
		}
	}
}

func TestMalformedMessagesDoNotPanic(t *testing.T) {
	_, room, seats := setup(t, 2)
	startDrawing(t, room, seats)
	for _, kind := range []string{"", "nope", "guess", "selectWord", "stroke", "fill", "updateSettings", "startGame", "undoStroke"} {
		for _, d := range []string{"", "null", "1", "[]", `"x"`, "{}", `{"guess":1}`, `{"word":[]}`} {
			for _, s := range seats {
				room.Handle(s.p, s.conn, Incoming{Type: kind, Data: json.RawMessage(d)})
			}
		}
	}
}

func TestConcurrentPlayers(t *testing.T) {
	m, room, seats := setup(t, 4)
	seats[0].do(room, "startGame", nil)
	var wg sync.WaitGroup
	for _, s := range seats {
		wg.Go(func() {
			for range 200 {
				s.do(room, "guess", data{"guess": "apple"})
				s.do(room, "selectWord", data{"word": "apple"})
				s.do(room, "undoStroke", nil)
				m.Join(room.Code, "", "", s.p.token, s.conn)
			}
		})
	}
	wg.Wait()
}

func TestGuessPoints(t *testing.T) {
	for remaining, want := range map[time.Duration]int{80: 300, 40: 175, 0: 50, -5: 50} {
		if got := guessPoints(remaining*time.Second, 80*time.Second); got != want {
			t.Errorf("guessPoints(%d) = %d, want %d", remaining, got, want)
		}
	}
}

func TestMaskWord(t *testing.T) {
	if got := maskWord("ice cream", map[int]bool{0: true}); got != "i__ _____" {
		t.Errorf("mask = %q", got)
	}
}
