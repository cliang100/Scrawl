let currentRoom = null;
let currentUserId = null;
let currentDrawerId = null;
let currentWord = null;
let turnOrder = [];
let isDrawer = false;
let isHost = false;
let selectedAvatar = '🎨'; // Default avatar

console.log('game.js loaded');

// Initialize avatar selection
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, setting up event listeners');
    
    // Check if we're on game page and restore game state from URL
    if (window.location.pathname === '/game') {
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        
        // Wait a moment for WebSocket to be ready, then request game state
        setTimeout(() => {
            console.log('Requesting game state for room:', roomCode);
            if (ws && ws.readyState === WebSocket.OPEN) {
                const nameParam = new URLSearchParams(window.location.search).get('name');
                ws.send(JSON.stringify({
                    type: 'getGameState',
                    data: { roomCode: roomCode, playerName: nameParam }
                }));
                console.log('Sent getGameState request');
            } else {
                console.log('WebSocket not ready, state:', ws ? ws.readyState : 'null');
            }
        }, 500);
    }
    
    // Avatar selection (only on lobby page)
    const avatarOptions = document.querySelectorAll('.avatar-option');
    if (avatarOptions.length > 0) {
        avatarOptions.forEach(option => {
            option.addEventListener('click', function() {
                // Remove selected class from all
                avatarOptions.forEach(opt => opt.classList.remove('selected'));
                // Add selected class to clicked
                this.classList.add('selected');
                selectedAvatar = this.dataset.avatar;
            });
        });
        
        // Select first avatar by default
        avatarOptions[0].classList.add('selected');
    }
});

function createRoom() {
    console.log('createRoom called, ws state:', ws ? ws.readyState : 'null');
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not connected');
        return;
    }
    
    const playerName = document.getElementById('playerName').value.trim();
    
    if (!playerName) {
        alert('Please enter your name before creating a room!');
        return;
    }
    
    const message = JSON.stringify({
        type: 'createRoom',
        data: {
            name: playerName,
            avatar: selectedAvatar
        }
    });
    
    console.log('Sending message:', message);
    ws.send(message);
    console.log('Sent createRoom message');
}

function joinRoom() {
    console.log('joinRoom called');
    const roomCode = document.getElementById('roomCode').value.trim();
    console.log('Room code entered:', roomCode);
    
    if (roomCode.length !== 6) {
        console.error('Invalid room code length:', roomCode.length);
        alert('Please enter a 6-character room code');
        return;
    }
    
    // Reconnect WebSocket if needed
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.log('Reconnecting WebSocket...');
        connectWebSocket();
        
        // Wait a moment for connection to establish
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                sendJoinMessage(roomCode);
            } else {
                alert('Unable to connect to server');
            }
        }, 500);
    } else {
        sendJoinMessage(roomCode);
    }
}

function sendJoinMessage(roomCode) {
    const playerName = document.getElementById('playerName').value.trim();
    
    if (!playerName) {
        alert('Please enter your name before joining a room!');
        return;
    }
    
    const message = JSON.stringify({
        type: 'joinRoom',
        data: { 
            roomCode: roomCode,
            name: playerName,
            avatar: selectedAvatar
        }
    });
    
    console.log('Sending join message:', message);
    ws.send(message);
    console.log('Sent joinRoom message');
}

function updateRoomUI(roomCode, players, hostId) {
    currentRoom = roomCode;
    currentPlayers = players;
    isHost = hostId === currentUserId;

    console.log('updateRoomUI called:', { roomCode, players, hostId, currentUserId, isHost });

    // Show room info section
    const roomInfoElement = document.getElementById('roomInfo');
    if (roomInfoElement) {
        roomInfoElement.classList.remove('hidden');
    }

    // Display room code in the span, not the input
    const roomCodeDisplay = document.getElementById('currentRoomCode');
    if (roomCodeDisplay) {
        roomCodeDisplay.textContent = roomCode;
        // Add click-to-copy functionality
        roomCodeDisplay.style.cursor = 'pointer';
        roomCodeDisplay.title = 'Click to copy room code';
        roomCodeDisplay.onclick = function() {
            navigator.clipboard.writeText(roomCode).then(() => {
                // Visual feedback
                const originalText = roomCodeDisplay.textContent;
                roomCodeDisplay.textContent = 'Copied!';
                setTimeout(() => {
                    roomCodeDisplay.textContent = originalText;
                }, 1500);
            });
        };
    }

    const playerListElement = document.getElementById('playerList');
    if (playerListElement) {
        playerListElement.innerHTML = '';
        // players is an object, not an array - convert it
        Object.values(players).forEach(player => {
            const li = document.createElement('li');
            const avatar = player.avatar || '👤'; // Fallback avatar
            const name = player.name || 'Player';
            li.innerHTML = `${avatar} ${name}${player.isHost ? ' (Host)' : ''}`;
            playerListElement.appendChild(li);
        });
    }
    
    const startGameBtn = document.getElementById('startGameBtn');
    if (startGameBtn) {
        startGameBtn.style.display = isHost ? 'block' : 'none';
    }
}

function navigateToGame() {
    const playerName = document.getElementById('playerName').value.trim();
    console.log('navigateToGame - playerName:', playerName, 'currentRoom:', currentRoom);
    window.location.href = `/game?room=${currentRoom}&name=${encodeURIComponent(playerName)}`;
}

function startGame() {
    if (!isHost) {
        alert('Only the host can start the game!');
        return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not connected');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'startGame',
        data: { roomCode: currentRoom }
    }));
    
    console.log('Sent startGame message');
}

function updateGameUI() {
    isDrawer = currentDrawerId === currentUserId;
    
    console.log('Updating game UI:', { 
        isDrawer, 
        currentDrawerId, 
        currentUserId, 
        currentPlayers: Object.keys(currentPlayers).length,
        comparison: currentDrawerId === currentUserId
    });
    
    // Update player list
    updateGamePlayerList();
    
    // Update turn status
    const turnStatus = document.getElementById('turnStatus');
    if (turnStatus) {
        const currentPlayer = turnOrder.find(id => id === currentDrawerId);
        const playerName = currentPlayer ? getPlayerName(currentPlayer) : 'Someone';
        const statusText = isDrawer ? 'You are drawing!' : `${playerName} is drawing...`;
        turnStatus.textContent = statusText;
        console.log('Turn status update:', { isDrawer, currentDrawerId, currentUserId, statusText });
    }
    
    // Show/hide drawing controls based on who's drawing
    const canvas = document.getElementById('drawingCanvas');
    const tools = document.querySelector('.drawing-tools');
    const guessInput = document.getElementById('guessInput');
    
    console.log('Drawing permissions check:', { isDrawer, currentUserId, currentDrawerId });
    
    if (isDrawer) {
        if (canvas) canvas.style.pointerEvents = 'auto';
        if (tools) tools.style.display = 'block';
        if (guessInput) guessInput.style.display = 'none';
        
        // Auto-request words if no word is selected yet
        console.log('Word selection logic:', { currentWord, isDrawer });
        if (!currentWord && isDrawer) {
            console.log('Auto-requesting words for drawer');
            showWordSelection(); // This should create the overlay
            selectWordFromServer();
        } else if (currentWord && isDrawer) {
            // Show current word being drawn
            console.log('Showing current word:', currentWord);
            showCurrentWord();
        }
    } else {
        if (canvas) canvas.style.pointerEvents = 'none';
        if (tools) tools.style.display = 'none';
        if (guessInput) guessInput.style.display = 'block';
        showGuessingUI();
    }
}

function updateGamePlayerList() {
    const playerListElement = document.getElementById('gamePlayerList');
    if (playerListElement && currentPlayers) {
        playerListElement.innerHTML = '';
        Object.values(currentPlayers).forEach(player => {
            const li = document.createElement('li');
            const avatar = player.avatar || '👤';
            const name = player.name || 'Player';
            const isCurrentDrawer = player.id === currentDrawerId;
            
            li.className = isCurrentDrawer ? 'current-drawer' : '';
            li.innerHTML = `${avatar} ${name}${player.isHost ? ' (Host)' : ''}${isCurrentDrawer ? ' ✏️' : ''}`;
            playerListElement.appendChild(li);
        });
    }
}

function getPlayerName(playerId) {
    if (!currentPlayers) return 'Someone';
    const player = Object.values(currentPlayers).find(p => p.id === playerId);
    return player ? player.name : 'Someone';
}

function showWordSelection() {
    console.log('showWordSelection called, isDrawer:', isDrawer);
    if (!isDrawer) return; // Only drawer can select words
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'word-selection-overlay';
    overlay.innerHTML = `
        <div class="word-selection-modal">
            <h3>Choose a word to draw:</h3>
            <div class="word-options">
                <button class="word-btn" onclick="selectWordFromServer()">Get Words</button>
            </div>
        </div>
    `;
    
    // Add to body and remove when word is selected
    document.body.appendChild(overlay);
    
    // Store reference to remove later
    window.wordSelectionOverlay = overlay;
}

function hideWordSelection() {
    if (window.wordSelectionOverlay) {
        document.body.removeChild(window.wordSelectionOverlay);
        window.wordSelectionOverlay = null;
    }
}

function selectWordFromServer() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'getWords',
            data: {}
        }));
        console.log('Requested words from server');
    }
}

// DEBUG: Force current user to be drawer
function forceDrawer() {
    currentDrawerId = currentUserId;
    isDrawer = true;
    updateGameUI();
    console.log('DEBUG: Forced current user to be drawer');
}

function selectWord(word) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'selectWord',
            data: { word: word }
        }));
        console.log('Selected word:', word);
        
        // Hide word selection overlay
        hideWordSelection();
    }
}

function showGuessingUI() {
    const wordDisplay = document.getElementById('wordDisplay');
    if (wordDisplay) {
        wordDisplay.innerHTML = `
            <div class="guessing-info">
                <h4>Someone is drawing...</h4>
                <p>Type your guess in the chat!</p>
            </div>
        `;
    }
}

function showCurrentWord() {
    const wordDisplay = document.getElementById('wordDisplay');
    if (wordDisplay) {
        wordDisplay.innerHTML = `<div class="word-display-drawer">You are drawing: <strong>${currentWord}</strong></div>`;
    }
}

function handleGameStateUpdate(data) {
    console.log('handleGameStateUpdate called with:', data);
    currentDrawerId = data.currentDrawerId;
    turnOrder = data.turnOrder;
    currentPlayers = data.players;
    currentWord = data.currentWord;
    
    // If only one player, make them the drawer
    if (turnOrder.length === 1) {
        currentDrawerId = currentUserId;
    }
    
    console.log('After processing - currentDrawerId:', currentDrawerId, 'currentUserId:', currentUserId);
    
    // Update UI after setting all variables
    setTimeout(() => {
        updateGameUI();
    }, 100);
}

function sendGuess() {
    const guessInput = document.getElementById('guessInput');
    const guess = guessInput.value.trim();
    
    if (guess && ws && ws.readyState === WebSocket.OPEN) {
        // Get current user's name
        const currentUser = currentPlayers[currentUserId];
        const userName = currentUser ? currentUser.name : 'Someone';
        
        ws.send(JSON.stringify({
            type: 'guess',
            data: { guess: guess, userName: userName }
        }));
        guessInput.value = '';
        console.log('Sent guess:', guess);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, setting up event listeners');
    
    // The buttons don't have IDs, they use onclick attributes
    // So we don't need to add event listeners!
    console.log('Buttons use onclick attributes, no event listeners needed');
});