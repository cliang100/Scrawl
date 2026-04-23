// Lobby Page JavaScript
let ws = null;
let currentRoomCode = null;
let isHost = false;
let playerName = '';
let playerAvatar = '';
let currentPlayers = [];
let gameSettings = {
    rounds: 3,
    drawTime: 80
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadPlayerData();
    setupUI();
    connectToRoom();
});

function loadPlayerData() {
    playerName = localStorage.getItem('scrawl_name') || 'Player';
    playerAvatar = localStorage.getItem('scrawl_avatar') || '🎨';
    isHost = localStorage.getItem('scrawl_is_host') === 'true';
    
    // Try URL param first, fallback to localStorage
    const urlParams = new URLSearchParams(window.location.search);
    currentRoomCode = urlParams.get('room') || localStorage.getItem('scrawl_room_code');
    
    if (!currentRoomCode) {
        window.location.href = '/';
        return;
    }
    
    document.getElementById('currentRoomCode').textContent = currentRoomCode;
}

function setupUI() {
    // Settings controls (host only)
    if (isHost) {
        document.getElementById('settingsSection').classList.add('is-host');
        
        // Rounds control
        setupSettingControl('rounds', 1, 10, (val) => {
            gameSettings.rounds = val;
            broadcastSettings();
        });
        
        // Time control
        setupSettingControl('time', 30, 180, (val) => {
            gameSettings.drawTime = val;
            broadcastSettings();
        }, 10, 's');
    } else {
        // Non-host: hide settings controls
        document.getElementById('settingsSection').classList.add('is-guest');
        document.querySelectorAll('.btn-minus, .btn-plus').forEach(btn => {
            btn.style.display = 'none';
        });
    }
    
    // Copy room code
    document.getElementById('copyCodeBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(currentRoomCode).then(() => {
            showToast('Room code copied!', 'success');
        });
    });
    
    // Leave room
    document.getElementById('leaveRoomBtn').addEventListener('click', () => {
        if (ws) ws.close();
        localStorage.removeItem('scrawl_room_code');
        localStorage.removeItem('scrawl_is_host');
        window.location.href = '/';
    });
    
    // Start game (host only)
    const startBtn = document.getElementById('startGameBtn');
    if (isHost) {
        startBtn.addEventListener('click', () => {
            if (currentPlayers.length < 2) {
                showToast('Need at least 2 players to start', 'error');
                return;
            }
            
            ws.send(JSON.stringify({
                type: 'startGame',
                data: {
                    roomCode: currentRoomCode,
                    maxRounds: gameSettings.rounds,
                    drawTime: gameSettings.drawTime
                }
            }));
        });
    }
    
    // Chat (placeholder)
    document.getElementById('lobbyChatSend').addEventListener('click', sendChatMessage);
    document.getElementById('lobbyChatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
}

function setupSettingControl(setting, min, max, callback, step = 1, suffix = '') {
    const minusBtn = document.querySelector(`[data-setting="${setting}"][data-delta="-${step}"]`);
    const plusBtn = document.querySelector(`[data-setting="${setting}"][data-delta="${step}"]`);
    const valueEl = document.getElementById(`${setting}Value`);
    
    let current = setting === 'rounds' ? gameSettings.rounds : gameSettings.drawTime;
    
    function updateDisplay() {
        valueEl.textContent = current + suffix;
    }
    
    minusBtn.addEventListener('click', () => {
        if (current > min) {
            current -= step;
            updateDisplay();
            callback(current);
        }
    });
    
    plusBtn.addEventListener('click', () => {
        if (current < max) {
            current += step;
            updateDisplay();
            callback(current);
        }
    });
}

function broadcastSettings() {
    if (!isHost || !ws) return;
    
    ws.send(JSON.stringify({
        type: 'updateSettings',
        data: gameSettings
    }));
}

function connectToRoom() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/${currentRoomCode}`);
    
    ws.onopen = () => {
        console.log('Connected to room:', currentRoomCode);
        ws.send(JSON.stringify({
            type: 'joinRoom',
            data: {
                name: playerName,
                avatar: playerAvatar
            }
        }));
    };
    
    ws.onmessage = handleServerMessage;
    
    ws.onclose = () => {
        console.log('Disconnected from room');
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showToast('Connection error', 'error');
    };
}

function handleServerMessage(event) {
    const message = JSON.parse(event.data);
    console.log('Server message:', message);
    
    switch (message.type) {
        case 'roomUpdated':
            updatePlayerList(message.data.players, message.data.hostId);
            break;
            
        case 'settingsUpdated':
            if (!isHost) {
                // Update settings from host
                gameSettings = message.data;
                document.getElementById('roundsValue').textContent = gameSettings.rounds;
                document.getElementById('timeValue').textContent = gameSettings.drawTime + 's';
            }
            break;
            
        case 'gameStarted':
            // Navigate to game
            window.location.href = `/game?room=${currentRoomCode}&name=${encodeURIComponent(playerName)}`;
            break;
            
        case 'roomError':
            showToast(message.data.error, 'error');
            break;
            
        case 'chatMessage':
            addChatMessage(message.data);
            break;
    }
}

function updatePlayerList(players, hostId) {
    const playersArray = Array.isArray(players) ? players : Object.values(players);
    currentPlayers = playersArray;
    const listEl = document.getElementById('playerList');
    const countEl = document.getElementById('playerCount');
    
    // Update count
    countEl.textContent = `(${playersArray.length}/8)`;
    
    // Clear and rebuild list
    listEl.innerHTML = '';
    
    playersArray.forEach(player => {
        const isPlayerHost = player.id === hostId;
        
        const item = document.createElement('div');
        item.className = 'player-item';
        item.innerHTML = `
            <div class="player-avatar">${player.avatar || '🎨'}</div>
            <div class="player-info">
                <div class="player-name">${player.name}</div>
                <div class="player-status">${isPlayerHost ? 'Host' : 'Waiting...'}</div>
            </div>
            ${isPlayerHost ? '<span class="player-host">HOST</span>' : ''}
        `;
        listEl.appendChild(item);
    });
    
    // Update start button state
    updateStartButton();
}

function updateStartButton() {
    const startBtn = document.getElementById('startGameBtn');
    const subtext = document.getElementById('startSubtext');
    const waitingMsg = document.getElementById('waitingMessage');
    
    if (isHost) {
        waitingMsg.style.display = 'none';
        
        if (currentPlayers.length < 2) {
            startBtn.disabled = true;
            subtext.textContent = `Need at least 2 players (${currentPlayers.length}/2)`;
        } else {
            startBtn.disabled = false;
            subtext.textContent = `${currentPlayers.length} players ready!`;
        }
    } else {
        waitingMsg.style.display = 'block';
        startBtn.style.display = 'none';
    }
}

function sendChatMessage() {
    const input = document.getElementById('lobbyChatInput');
    const message = input.value.trim();
    
    if (!message || !ws) return;
    
    ws.send(JSON.stringify({
        type: 'lobbyChat',
        data: {
            message: message,
            sender: playerName,
            avatar: playerAvatar
        }
    }));
    
    input.value = '';
}

function addChatMessage(data) {
    const chatEl = document.getElementById('lobbyChat');
    
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message';
    msgEl.innerHTML = `
        <span class="chat-avatar">${data.avatar}</span>
        <span class="chat-sender">${data.sender}:</span>
        <span class="chat-text">${data.message}</span>
    `;
    
    // Remove welcome message if exists
    const welcome = chatEl.querySelector('.chat-welcome');
    if (welcome) welcome.remove();
    
    chatEl.appendChild(msgEl);
    chatEl.scrollTop = chatEl.scrollHeight;
}

// Toast Notification
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}
