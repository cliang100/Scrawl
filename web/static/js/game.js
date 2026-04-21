let currentRoom = null;
let currentUserId = null;
let currentDrawerId = null;
let currentWord = null;
let countdownInterval = null;
let turnOrder = [];
let isDrawer = false;
let isHost = false;
let selectedAvatar = '🎨'; // Default avatar
let revealedLetters = [];
let wordLength = 0;

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
    
    // Show/hide drawing controls based on who's drawing
    const canvas = document.getElementById('drawingCanvas');
    const tools = document.querySelector('.toolbar');
    const guessInput = document.getElementById('guessInput');
    
    console.log('Drawing permissions check:', { isDrawer, currentUserId, currentDrawerId });
    
    if (isDrawer && currentWord) {
        if (canvas) canvas.style.pointerEvents = 'auto';
        if (tools) tools.style.display = 'flex';
        if (guessInput) {
            guessInput.style.display = 'block';
            guessInput.placeholder = 'Type your guess here...';
        }
        showWordDisplay('drawer', currentWord);
    } else if (isDrawer && !currentWord) {
        if (canvas) canvas.style.pointerEvents = 'none';
        if (tools) tools.style.display = 'none';
        showWordDisplay('waiting');
        showGuessingUI();
    } else {
        if (canvas) canvas.style.pointerEvents = 'none';
        if (tools) tools.style.display = 'none';
        if (guessInput) guessInput.style.display = 'block';
        showWordDisplay('guesser', currentWord || '');
        showGuessingUI();
    }
}

function updateGamePlayerList() {
    const playerListElement = document.getElementById('gamePlayerList');
    if (playerListElement && currentPlayers) {
        playerListElement.innerHTML = '';
        
        // Sort players by score (descending) for ranking
        const sortedPlayers = Object.values(currentPlayers).sort((a, b) => (b.score || 0) - (a.score || 0));
        
        let currentRank = 1;
        let previousScore = null;
        
        sortedPlayers.forEach((player, index) => {
            const playerBox = document.createElement('div');
            playerBox.className = 'player-box';
            
            const avatar = player.avatar || '👤';
            const name = player.name || 'Player';
            const isCurrentDrawer = player.id === currentDrawerId;
            const isYou = player.id === currentUserId;
            const score = player.score || 0;
            
            // Handle tied rankings - if score differs from previous, update rank
            if (previousScore !== null && score !== previousScore) {
                currentRank = index + 1;
            }
            previousScore = score;
            
            // Add alternating background class
            if (index % 2 === 1) {
                playerBox.classList.add('alt-row');
            }
            
            // Add current drawer highlight
            if (isCurrentDrawer) {
                playerBox.classList.add('current-drawer');
            }
            
            playerBox.innerHTML = `
                <div class="player-rank">#${currentRank}</div>
                ${player.isHost ? '<div class="player-host">👑</div>' : '<div class="player-host-placeholder"></div>'}
                <div class="player-info">
                    <div class="player-name">${name}${isYou ? ' <span class="you-tag">(You)</span>' : ''}${isCurrentDrawer ? ' ✏️' : ''}</div>
                    <div class="player-score">${score} points</div>
                </div>
                <div class="player-avatar">${avatar}</div>
            `;
            
            playerListElement.appendChild(playerBox);
        });
    }
}

function getPlayerName(playerId) {
    if (!currentPlayers) return 'Someone';
    const player = Object.values(currentPlayers).find(p => p.id === playerId);
    return player ? player.name : 'Someone';
}

function hideWordSelection() {
    if (window.wordSelectionOverlay) {
        document.body.removeChild(window.wordSelectionOverlay);
        window.wordSelectionOverlay = null;
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

function startCountdown(duration) {
    if (countdownInterval) clearInterval(countdownInterval);

    let timeLeft = duration;
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.textContent = timeLeft;

    countdownInterval = setInterval(() => {
        timeLeft--;
        if (timerEl) timerEl.textContent = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }, 1000);
}

// Guesser
function showWordDisplay(type, word = '') {
    const wordDisplay = document.getElementById('wordDisplay');
    if (!wordDisplay) return;
    
    const wordLabel = wordDisplay.querySelector('.word-label');
    const wordContent = wordDisplay.querySelector('.word-content');
    const letterCount = wordDisplay.querySelector('.letter-count');
    
    wordDisplay.classList.remove('waiting');
    
    if (type === 'drawer') {
        wordLabel.textContent = 'DRAW THIS';
        wordContent.textContent = word.toLowerCase();
        letterCount.style.display = 'none';
    } else if (type === 'guesser') {
        wordLabel.textContent = 'GUESS THIS';
        letterCount.style.display = 'inline-block';
        letterCount.textContent = wordLength.toString();
        updateWordDisplay();
    } else if (type === 'waiting') {
        wordDisplay.classList.add('waiting');
        wordLabel.textContent = '';
        wordContent.textContent = 'WAITING';
        letterCount.style.display = 'none';
    }
}

function showGuessingUI() {
    // Word display now handles all drawer/guesser indication
    // No need for separate turnStatus text
}

function showCurrentWord() {
    // Handled by showWordDisplay
}

function updateWordDisplay() {
    if (currentDrawerId === currentUserId) return; // drawer sees full word, not hangman
    const wordContent = document.querySelector('.word-content');
    if (!wordContent || wordLength === 0) return;

    let display = '';
    for (let i = 0; i < wordLength; i++) {
        display += revealedLetters[i] ? revealedLetters[i] : '_';
        if (i < wordLength - 1) display += ' ';
    }
    wordContent.textContent = display;
}

function handleGameStateUpdate(data) {
    console.log('handleGameStateUpdate called with:', data);
    currentDrawerId = data.currentDrawerId;
    turnOrder = data.turnOrder;
    currentPlayers = data.players;
    currentWord = data.currentWord;
    
    // Drawer is considered a "winner" for chat purposes
    if (currentDrawerId === currentUserId && currentWord) {
        isWinner = true;
        console.log('Game state: Drawer set isWinner to true');
    }
    
    // Update Rounds
    const roundDisplay = document.getElementById('roundDisplay');
    if (roundDisplay && data.round && data.maxRounds) {
        roundDisplay.textContent = `Round ${data.round} of ${data.maxRounds}`;
    }

    console.log('After processing - currentDrawerId:', currentDrawerId, 'currentUserId:', currentUserId);
    
    // Update UI after setting all variables
    setTimeout(() => {
        updateGameUI();
    }, 100);
    revealedLetters = [];
    wordLength = 0;
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
    
    // Enter key support (guessing)
    const guessInput = document.getElementById('guessInput');
    if (guessInput) {
        guessInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                sendGuess();
            }
        });
    }

    console.log('Buttons use onclick attributes, no event listeners needed');
});