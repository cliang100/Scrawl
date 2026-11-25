package game

import (
	"encoding/json"
	"regexp"
)

const (
	// The canvas is 800x600 for everyone; browsers scale it.
	canvasWidth  = 800
	canvasHeight = 600

	maxPointsPerStroke = 100
	maxCanvasOps       = 5000
)

var colorPattern = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

type point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

func (p point) valid() bool {
	return p.X >= 0 && p.X <= canvasWidth && p.Y >= 0 && p.Y <= canvasHeight
}

// canvasOp is a batch of stroke points or one fill.
type canvasOp struct {
	Type     string  `json:"type"`
	StrokeID string  `json:"strokeId,omitempty"`
	Points   []point `json:"points"`
	Color    string  `json:"color"`
	Size     float64 `json:"size,omitempty"`
}

func parseCanvasOp(kind string, raw json.RawMessage) (canvasOp, bool) {
	var op canvasOp
	if json.Unmarshal(raw, &op) != nil || !colorPattern.MatchString(op.Color) {
		return op, false
	}
	op.Type = kind
	for _, p := range op.Points {
		if !p.valid() {
			return op, false
		}
	}
	if kind == "fill" {
		return op, len(op.Points) == 1
	}
	ok := len(op.Points) > 0 && len(op.Points) <= maxPointsPerStroke &&
		op.StrokeID != "" && len(op.StrokeID) <= 64 && op.Size > 0 && op.Size <= 50
	return op, ok
}

// undo drops the last fill, or every batch of the last stroke.
func undo(ops []canvasOp) []canvasOp {
	if len(ops) == 0 {
		return ops
	}
	last := ops[len(ops)-1]
	ops = ops[:len(ops)-1]
	for last.Type == "stroke" && len(ops) > 0 && ops[len(ops)-1].StrokeID == last.StrokeID {
		ops = ops[:len(ops)-1]
	}
	return ops
}
