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
    const roomCode = (urlParams.get('room') || '').toUpperCase();
    
    if (/^[A-Z0-9]{6}$/.test(roomCode)) {
        inviteRoomCode = roomCode;
        showInviteUI(inviteRoomCode);
    }
}

// Show invite UI when coming from invite link
function showInviteUI(roomCode) {
    const banner = el('div', 'invite-banner');
    banner.append(
        el('p', 'invite-text', "You've been invited to join room:"),
        el('div', 'invite-code', roomCode),
    );
    document.querySelector('.room-actions').prepend(banner);
}

// Avatar Selection
function setupAvatarSelection() {
    const avatarOptions = document.querySelectorAll('.avatar-option');
    const selectedAvatarEl = document.getElementById('selectedAvatar');
    
    avatarOptions.forEach(option => {
        option.addEventListener('click', () => {
            avatarOptions.forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
            selectedAvatar = option.dataset.avatar;
            selectedAvatarEl.textContent = selectedAvatar;
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

function connectAndCreateRoom(name) {
    connect('createRoom', { name, avatar: selectedAvatar });
}

function connectAndJoinRoom(name, roomCode) {
    connect('joinRoom', { name, avatar: selectedAvatar, roomCode, token: loadToken(roomCode) });
}

function connect(type, data) {
    if (ws) ws.close();
    ws = openSocket();
    ws.onopen = () => sendMessage(ws, type, data);
    ws.onmessage = handleServerMessage;
    ws.onerror = () => showToast('Connection failed', 'error');
}

function handleServerMessage(event) {
    const { type, data } = JSON.parse(event.data);

    switch (type) {
        case 'roomCreated':
        case 'roomJoined':
            saveToken(data.roomCode, data.token);
            window.location.href = `/${data.roomCode}`;
            break;

        case 'roomError':
            showToast(data.error, 'error');
            ws.close();
            break;
    }
}
