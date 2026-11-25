package game

import (
	"errors"
	"math/rand/v2"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"scrawl/internal/words"
)

var (
	avatars   = []string{"🎨", "🦊", "🐱", "🐶", "🦄", "🐼", "🦋", "🐸", "🦁", "🐰", "🦉", "🐙"}
	drawTimes = []int{30, 40, 60, 80, 100, 120, 150, 180}

	errBadName   = errors.New("name must be 2 to 12 characters")
	errBadAvatar = errors.New("unknown avatar")
)

func cleanProfile(name, avatar string) (string, string, error) {
	name = strings.TrimSpace(name)
	if n := utf8.RuneCountInString(name); n < 2 || n > 12 || strings.ContainsFunc(name, unicode.IsControl) {
		return "", "", errBadName
	}
	if !slices.Contains(avatars, avatar) {
		return "", "", errBadAvatar
	}
	return name, avatar, nil
}

func (s Settings) valid() bool {
	return s.Rounds >= 1 && s.Rounds <= 5 && slices.Contains(drawTimes, s.DrawTime)
}

// guessPoints gives 50 for a last-second guess up to 300 for an instant one.
func guessPoints(remaining, total time.Duration) int {
	return 50 + int(250*max(remaining, 0)/total)
}

func pickWords(n int) []string {
	picks := make([]string, 0, n)
	for _, i := range rand.Perm(len(words.DrawingWords))[:n] {
		picks = append(picks, words.DrawingWords[i])
	}
	return picks
}

// hintDelays says how far into the turn each letter is revealed.
func hintDelays(word string, drawTime time.Duration) []time.Duration {
	count := 1
	if n := len(word); n >= 10 {
		count = 3
	} else if n >= 5 {
		count = 2
	}
	delays := make([]time.Duration, count)
	for i, eightieths := range []int{35, 55, 70}[:count] {
		delays[i] = drawTime * time.Duration(eightieths) / 80
	}
	return delays
}

// maskWord hides unrevealed letters and keeps spaces.
func maskWord(word string, revealed map[int]bool) string {
	mask := []byte(word)
	for i, c := range mask {
		if c != ' ' && !revealed[i] {
			mask[i] = '_'
		}
	}
	return string(mask)
}
