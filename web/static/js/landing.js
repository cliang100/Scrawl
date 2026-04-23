// Landing Page JavaScript
let selectedAvatar = '🎨';
let ws = null;

// Invite link room code (from URL ?room=XYZ)
let inviteRoomCode = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupAvatarSelection();
    checkForInviteLink();
    setupRoomActions();
    loadSavedData();
});

// Check for invite link in URL
function checkForInviteLink() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    
    if (roomCode) {
        inviteRoomCode = roomCode.toUpperCase();
        showInviteUI(inviteRoomCode);
    }
}

// Show invite UI when coming from invite link
function showInviteUI(roomCode) {
    const roomActions = document.querySelector('.room-actions');
    if (!roomActions) return;
    
    // Replace room actions with invite-specific UI
    roomActions.innerHTML = `
        <div class="invite-banner">
            <p class="invite-text">You've been invited to join room:</p>
            <div class="invite-code">${roomCode}</div>
        </div>
        <button class="btn btn-primary" id="playBtn">
            <span class="btn-icon">🎮</span>
            Play
        </button>
        <div class="divider">or</div>
        <button class="btn btn-secondary" id="createPrivateBtn">
            <span class="btn-icon">🔒</span>
            Create Private Room
        </button>
    `;
    
    // Setup invite buttons
    document.getElementById('playBtn').addEventListener('click', () => {
        const name = document.getElementById('playerName').value.trim();
        if (!validateName(name)) return;
        
        savePlayerData(name);
        connectAndJoinRoom(name, roomCode);
    });
    
    document.getElementById('createPrivateBtn').addEventListener('click', () => {
        // Remove invite UI and show normal create/join
        location.href = '/'; // Reload without room param
    });
}

// Avatar Selection
function setupAvatarSelection() {
    const avatarOptions = document.querySelectorAll('.avatar-option');
    const selectedAvatarEl = document.getElementById('selectedAvatar');
    
    avatarOptions.forEach(option => {
        option.addEventListener('click', () => {
            // Remove active class from all
            avatarOptions.forEach(opt => opt.classList.remove('active'));
            // Add to clicked
            option.classList.add('active');
            // Update selected
            selectedAvatar = option.dataset.avatar;
            selectedAvatarEl.textContent = selectedAvatar;
            // Save preference
            localStorage.setItem('scrawl_avatar', selectedAvatar);
        });
    });
}

// Room Actions
function setupRoomActions() {
    const playBtn = document.getElementById('playBtn');
    const createBtn = document.getElementById('createRoomBtn');
    const joinBtn = document.getElementById('joinRoomBtn');
    const backBtn = document.getElementById('backBtn');
    const nameInput = document.getElementById('playerName');
    const roomInput = document.getElementById('roomCode');
    const joinUI = document.getElementById('joinUI');
    
    // Play button - join room (invite or show join UI)
    playBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!validateName(name)) return;
        
        savePlayerData(name);
        
        if (inviteRoomCode) {
            // Coming from invite link - join directly
            connectAndJoinRoom(name, inviteRoomCode);
        } else {
            // Normal play - show join UI
            playBtn.classList.add('hidden');
            createBtn.classList.add('hidden');
            joinUI.classList.remove('hidden');
            roomInput.focus();
        }
    });
    
    // Create Private Room button
    createBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!validateName(name)) return;
        
        savePlayerData(name);
        connectAndCreateRoom(name);
    });
    
    // Join button (from join UI)
    joinBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        const roomCode = roomInput.value.trim().toUpperCase();
        
        if (!validateName(name)) return;
        if (!roomCode) {
            showToast('Please enter a room code', 'error');
            return;
        }
        
        savePlayerData(name);
        connectAndJoinRoom(name, roomCode);
    });
    
    // Back button (return to main buttons)
    backBtn.addEventListener('click', () => {
        joinUI.classList.add('hidden');
        playBtn.classList.remove('hidden');
        createBtn.classList.remove('hidden');
    });
    
    // Enter key support
    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') createBtn.click();
    });
    
    roomInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinBtn.click();
    });
}

function validateName(name) {
    if (!name) {
        showToast('Please enter your name', 'error');
        return false;
    }
    if (name.length < 2) {
        showToast('Name must be at least 2 characters', 'error');
        return false;
    }
    if (name.length > 12) {
        showToast('Name must be 12 characters or less', 'error');
        return false;
    }
    return true;
}

function savePlayerData(name) {
    localStorage.setItem('scrawl_name', name);
    localStorage.setItem('scrawl_avatar', selectedAvatar);
}

function loadSavedData() {
    const savedName = localStorage.getItem('scrawl_name');
    const savedAvatar = localStorage.getItem('scrawl_avatar');
    
    if (savedName) {
        document.getElementById('playerName').value = savedName;
    }
    
    if (savedAvatar) {
        selectedAvatar = savedAvatar;
        document.getElementById('selectedAvatar').textContent = selectedAvatar;
        
        // Update active state in grid
        document.querySelectorAll('.avatar-option').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.avatar === savedAvatar);
        });
    }
}

// WebSocket Connection for Room Creation/Joining
function connectAndCreateRoom(playerName) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    
    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'createRoom',
            data: {
                name: playerName,
                avatar: selectedAvatar
            }
        }));
    };
    
    ws.onmessage = handleServerMessage;
    ws.onerror = () => showToast('Connection failed', 'error');
}

function connectAndJoinRoom(playerName, roomCode) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/${roomCode}`);
    
    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'joinRoom',
            data: {
                name: playerName,
                avatar: selectedAvatar
            }
        }));
    };
    
    ws.onmessage = handleServerMessage;
    ws.onerror = () => showToast('Connection failed', 'error');
}

function handleServerMessage(event) {
    const message = JSON.parse(event.data);
    console.log('Server message:', message);
    
    switch (message.type) {
        case 'roomCreated':
            localStorage.setItem('scrawl_room_code', message.data.roomCode);
            localStorage.setItem('scrawl_is_host', 'true');
            window.location.href = `/${message.data.roomCode}`;
            break;
            
        case 'roomJoined':
            localStorage.setItem('scrawl_room_code', message.data.roomCode);
            localStorage.setItem('scrawl_is_host', 'false');
            window.location.href = `/${message.data.roomCode}`;
            break;
            
        case 'roomError':
            showToast(message.data.error, 'error');
            if (ws) ws.close();
            break;
    }
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
