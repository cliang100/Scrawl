let currentRoom = null;
let isHost = false;

console.log('game.js loaded');

function createRoom() {
    console.log('createRoom called, ws state:', ws ? ws.readyState : 'null');
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not connected');
        return;
    }
    
    const message = JSON.stringify({
        type: 'createRoom'
    });
    
    console.log('Sending message:', message);
    ws.send(message);
    console.log('Sent createRoom message');
}

function joinRoom() {
    console.log('joinRoom called')
    const roomCode = document.getElementById('roomCode').value.trim().toUpperCase();
    console.log('Room code entered:', roomCode)

    if (roomCode.length === 6) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket not connected');
            return;
        }

        const message = JSON.stringify({
            type: 'joinRoom',
            data: { roomCode: roomCode }
        });

        console.log('Sending join message:', message);
        ws.send(message);
        console.log('Sent joinRoom message');
    } else {
        console.error('Invalid room code length:', roomCode.length);
        alert('Please enter a 6-character room code');
    }
}

function updateRoomUI(roomCode, players, hostId) {
    document.getElementById('currentRoomCode').textContent = roomCode;
    document.getElementById('roomInfo').classList.remove('hidden');
    
    const playersList = document.getElementById('players');
    playersList.innerHTML = '';
    
    players.forEach(player => {
        const li = document.createElement('li');
        li.textContent = `${player.Name} ${player.IsHost ? '(Host)' : ''}`;
        playersList.appendChild(li);
    });
    
    currentRoom = roomCode;
    isHost = players.some(player => player.IsHost);
    
    const startButton = document.getElementById('startButton');
    if (isHost) {
        startButton.classList.remove('hidden');
    }
}

function navigateToGame() {
    window.location.href = `/game?room=${currentRoom}`;
}

function startGame() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not connected');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'startGame',
        data: { roomCode: currentRoom }
    }));
    
    console.log('Sent startGame message');
    navigateToGame();
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, setting up event listeners');
    
    // The buttons don't have IDs, they use onclick attributes
    // So we don't need to add event listeners!
    console.log('Buttons use onclick attributes, no event listeners needed');
});