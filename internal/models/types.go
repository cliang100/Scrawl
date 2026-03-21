package models

import "github.com/gorilla/websocket"

type Message struct {
	Type	string		`json:"type"`
	Data	interface{}	`json:"data"`
	RoomID	string		`json:"roomId,omitempty"`
	UserID 	string		`json:"userId,omitempty"`	
}

type Client struct {
	ID		string
	RoomID	string
	Conn	*websocket.Conn
	Send	chan Message
}

type Hub struct {
	Clients		map[*Client]bool
	Rooms		map[string]map[*Client]bool
	Register	chan *Client
	Unregister 	chan *Client
	Broadcast 	chan Message
}