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
        // Get current user's name from lobbyPlayers or localStorage
        let userName = 'Someone';
        const myPlayer = currentPlayers ? Object.values(currentPlayers).find(p => p.id === currentUserId) : null;
        if (myPlayer) {
            userName = myPlayer.name;
        } else {
            // Fallback to localStorage
            userName = localStorage.getItem('scrawl_player_name') || 'Someone';
        }
        
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

    // Initialize lobby overlay if on room page
    initLobby();

    console.log('Buttons use onclick attributes, no event listeners needed');
});

// ========== LOBBY OVERLAY MANAGEMENT ==========

let lobbySettings = {
    maxPlayers: 8,
    rounds: 3,
    drawTime: 80
};

let lobbyPlayers = [];
let gameStarted = false;

function initLobby() {
    // Check if we're on a room page (URL has room code)
    const path = window.location.pathname;
    const roomCode = path.substring(1);
    
    // Skip if on landing page or other non-room paths
    if (!roomCode || roomCode === '' || roomCode === 'game' || roomCode === 'lobby') {
        console.log('Not on room page, skipping lobby init');
        return;
    }
    
    console.log('Initializing lobby for room:', roomCode);
    currentRoom = roomCode;
    
    // Load player data
    const playerName = localStorage.getItem('scrawl_name') || 'Player';
    const playerAvatar = localStorage.getItem('scrawl_avatar') || '🎨';
    isHost = localStorage.getItem('scrawl_is_host') === 'true';
    
    // Update room code display
    const roomCodeEl = document.getElementById('lobbyRoomCode');
    if (roomCodeEl) roomCodeEl.textContent = roomCode.toUpperCase();
    
    // Setup lobby UI
    setupLobbyControls();
    updateLobbyPlayerCount();
    
    // Send joinRoom message once WebSocket is ready
    setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log('Sending joinRoom for:', playerName, playerAvatar);
            ws.send(JSON.stringify({
                type: 'joinRoom',
                data: {
                    name: playerName,
                    avatar: playerAvatar
                }
            }));
        } else {
            console.log('WebSocket not ready yet, will retry...');
        }
    }, 500);
}

function setupLobbyControls() {
    const overlay = document.getElementById('lobbyOverlay');
    if (!overlay) return;
    
    // Host/guest styling
    if (!isHost) {
        overlay.classList.add('is-guest');
    }
    
    // Setup dropdowns (host only can click)
    setupDropdown('rounds', (val) => {
        lobbySettings.rounds = parseInt(val);
        broadcastSettings();
    });
    
    setupDropdown('drawTime', (val) => {
        lobbySettings.drawTime = parseInt(val);
        broadcastSettings();
    });
    
    // Start game button (host only)
    const startBtn = document.getElementById('startGameBtn');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            const playerCount = lobbyPlayers.length;
            if (playerCount < 2) {
                showToast('Need at least 2 players!', 'error');
                return;
            }
            
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'startGame',
                    data: {
                        roomCode: currentRoom,
                        maxRounds: lobbySettings.rounds,
                        drawTime: lobbySettings.drawTime
                    }
                }));
            }
        });
    }
    
    // Copy invite button
    const copyBtn = document.getElementById('copyCodeBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const code = currentRoom || '';
            const inviteUrl = `${window.location.origin}/?room=${code}`;
            navigator.clipboard.writeText(inviteUrl).then(() => {
                showToast('Invite link copied!', 'success');
            });
        });
    }
}

function setupDropdown(settingName, onChange) {
    const dropdown = document.getElementById(settingName + 'Dropdown');
    if (!dropdown) return;
    
    const valueEl = dropdown.querySelector('.dropdown-value');
    const menu = dropdown.querySelector('.dropdown-menu');
    
    dropdown.addEventListener('click', (e) => {
        if (!isHost) return;
        e.stopPropagation();
        document.querySelectorAll('.dropdown-menu').forEach(m => {
            if (m !== menu) m.classList.add('hidden');
        });
        menu.classList.toggle('hidden');
    });
    
    const items = dropdown.querySelectorAll('.dropdown-item');
    items.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const val = item.dataset.value;
            valueEl.textContent = item.textContent;
            menu.classList.add('hidden');
            onChange(val);
        });
    });
}

document.addEventListener('click', () => {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.add('hidden'));
});

function handleLobbyMessage(event) {
    const message = JSON.parse(event.data);
    console.log('Lobby message:', message);
    
    switch (message.type) {
        case 'roomUpdated':
            updateLobbyPlayers(message.data.players, message.data.hostId);
            break;
            
        case 'settingsUpdated':
            if (!isHost) {
                lobbySettings = message.data;
                updateSettingsDisplay();
            }
            break;
            
        case 'gameStarted':
            hideLobbyOverlay();
            gameStarted = true;
            startGameFromLobby(message.data);
            break;
            
        case 'roomError':
            showToast(message.data.error, 'error');
            break;
    }
}

function updateLobbyPlayers(players, hostId) {
    const playersArray = Array.isArray(players) ? players : Object.values(players);
    lobbyPlayers = playersArray;
    
    // Update left sidebar player list
    const listEl = document.getElementById('gamePlayerList');
    if (!listEl) return;
    
    listEl.innerHTML = '';
    
    let currentRank = 1;
    let lastScore = null;
    
    playersArray.forEach((player, index) => {
        const playerScore = player.score || 0;
        if (lastScore !== null && playerScore < lastScore) {
            currentRank = index + 1;
        }
        lastScore = playerScore;
        
        const isPlayerHost = player.id === hostId;
        const isYou = player.id === currentUserId;
        
        const card = document.createElement('div');
        card.className = 'player-box' + (index % 2 === 1 ? ' alt-row' : '');
        card.innerHTML = `
            <div class="player-rank">#${currentRank}</div>
            ${isPlayerHost ? '<div class="player-host">👑</div>' : '<div class="player-host-placeholder"></div>'}
            <div class="player-info">
                <div class="player-name">${player.name}${isYou ? ' <span class="you-tag">(You)</span>' : ''}</div>
                <div class="player-score">${playerScore} points</div>
            </div>
            <div class="player-avatar">${player.avatar || '🎨'}</div>
        `;
        listEl.appendChild(card);
    });
    
    updateStartButton();
}

function hideLobbyOverlay() {
    const overlay = document.getElementById('lobbyOverlay');
    if (overlay) {
        overlay.classList.add('exiting');
        setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('exiting');
        }, 600);
    }
}

function updateStartButton() {
    const startBtn = document.getElementById('startGameBtn');
    if (!startBtn || !isHost) return;
    
    const canStart = lobbyPlayers.length >= 2;
    startBtn.disabled = !canStart;
    
    if (!canStart) {
        startBtn.title = `Need ${2 - lobbyPlayers.length} more player${lobbyPlayers.length === 1 ? '' : 's'} to start`;
    } else {
        startBtn.title = 'Start the game!';
    }
}

function updateLobbyPlayerCount() {
    const maxDisplay = document.getElementById('maxPlayersDisplay');
    if (maxDisplay) maxDisplay.textContent = lobbySettings.maxPlayers;
}

function updateSettingsDisplay() {
    const roundsVal = document.getElementById('roundsValue');
    const timeVal = document.getElementById('drawTimeValue');
    if (roundsVal) roundsVal.textContent = lobbySettings.rounds;
    if (timeVal) timeVal.textContent = lobbySettings.drawTime + 's';
}

function broadcastSettings() {
    if (!isHost || !ws) return;
    
    ws.send(JSON.stringify({
        type: 'updateSettings',
        data: lobbySettings
    }));
}

function startGameFromLobby(data) {
    console.log('Starting game with settings:', data);
    
    if (data.rounds) {
        const roundDisplay = document.getElementById('roundDisplay');
        if (roundDisplay) roundDisplay.textContent = `Round 1 of ${data.rounds}`;
    }
    
    if (data.drawTime) {
        const timer = document.getElementById('timer');
        if (timer) timer.textContent = data.drawTime + 's';
    }
    
    ws.send(JSON.stringify({
        type: 'getGameState',
        data: { roomCode: currentRoom }
    }));
}

function showToast(message, type = 'info') {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast hidden';
        document.body.appendChild(toast);
        
        if (!document.getElementById('toast-styles')) {
            const style = document.createElement('style');
            style.id = 'toast-styles';
            style.textContent = `
                .toast {
                    position: fixed;
                    bottom: 30px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #333;
                    color: white;
                    padding: 14px 28px;
                    border-radius: 10px;
                    font-weight: 600;
                    z-index: 10000;
                    transition: all 0.3s;
                    font-family: 'Nunito', sans-serif;
                }
                .toast.hidden { opacity: 0; transform: translateX(-50%) translateY(20px); pointer-events: none; }
                .toast.success { background: #48bb78; }
                .toast.error { background: #e53e3e; }
            `;
            document.head.appendChild(style);
        }
    }
    
    toast.textContent = message;
    toast.className = `toast ${type}`;
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}
