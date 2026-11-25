function openSocket() {
    const url = new URL('/ws', BACKEND_URL || window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WebSocket(url);
}

function sendMessage(socket, type, data = {}) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, data }));
    }
}

// Session storage is per tab, so two tabs can play as two players.
function saveToken(roomCode, token) {
    sessionStorage.setItem(`scrawl_token_${roomCode}`, token);
}

function loadToken(roomCode) {
    return sessionStorage.getItem(`scrawl_token_${roomCode}`) || '';
}

function clearToken(roomCode) {
    sessionStorage.removeItem(`scrawl_token_${roomCode}`);
}

let toastTimer = null;

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
