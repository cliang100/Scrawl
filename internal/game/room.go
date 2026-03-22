package game

import "scrawl/internal/models"

func NewRoomManager() *models.RoomManager {
	return &models.RoomManager{
		Rooms: make(map[string]*models.Room),
	}
}