let ws;

function connectWebSocket() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');

    console.log('Room code from URL:', roomCode);

    if (roomCode) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws/${roomCode}`);
    } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    }

    ws.onopen = function(event) {
        console.log('WebSocket connected, currentUserId set to:', currentUserId);
    };

    ws.onmessage = function(event) {
        const message = JSON.parse(event.data);
        console.log('Message from server:', message);

        const initialConnectionMessages = ['roomCreated', 'roomJoined', 'gameStateUpdate'];
        if (message.userId && initialConnectionMessages.includes(message.type) && !currentUserId) {
            currentUserId = message.userId;
            console.log('Set currentUserId to:', currentUserId);
        }

        switch (message.type) {
            case 'roomCreated':
                console.log('Processing roomCreated:', message.data);
                console.log('Full message object:', message);
                updateRoomUI(message.data.roomCode, message.data.players, message.data.hostId);
                break;
            case 'roomJoined':
                console.log('Processing roomJoined:', message.data);
                updateRoomUI(message.data.roomCode, message.data.players, message.data.hostId);
                break;
            case 'roomError':
                console.log('Processing roomError:', message.data);
                alert(message.data.error);
                break;
            case 'roomUpdated':
                console.log('Processing roomUpdated:', message.data);
                updateRoomUI(message.data.roomCode, message.data.players, message.data.hostId);
                break;
            case 'gameStarted':
                const name = document.getElementById('playerName')?.value.trim() || '';
                console.log('gameStarted recieved, navigating with name', name);
                window.location.href = `/game?room=${message.data.roomCode}&name=${encodeURIComponent(name)}`;
                break;
            case 'gameStateUpdate':
                console.log('Processing gameStateUpdate:', message.data);
                handleGameStateUpdate(message.data);
                break;
            case 'wordSelected':
                console.log('Processing wordSelected:', message.data);
                currentWord = message.data.word;
                console.log('currentWord set to:', currentWord);
                currentDrawerId = message.data.drawerID;
                hideWordSelection();
                updateGameUI();
                
                // Update word display for all players
                const wordDisplayEl = document.getElementById('wordDisplay');
                if (wordDisplayEl) {
                    if (currentDrawerId === currentUserId) {
                        wordDisplayEl.innerHTML = `<div class="word-display-drawer">You are drawing: <strong>${currentWord}</strong></div>`;
                    } else {
                        wordDisplayEl.innerHTML = `<div class="word-display-guesser">Someone is drawing...</div>`;
                    }
                }
                break;
            case 'getWords':
                console.log('Processing getWords:', message.data);
                console.log('words array:', message.data.words);
                const words = message.data.words;

                if (!window.wordSelectionOverlay) {
                    console.log('Creating new overlay');
                    const overlay = document.createElement('div');
                    overlay.className = 'word-selection-overlay';
                    document.body.appendChild(overlay);
                    window.wordSelectionOverlay = overlay;
                }
                const modal = window.wordSelectionOverlay.querySelector('.word-selection-modal')
                    || (() => {
                        const m = document.createElement('div');
                        m.className = 'word-selection-modal';
                        window.wordSelectionOverlay.appendChild(m);
                        return m;
                    })();

                modal.innerHTML = `
                    <h3>Choose a word to draw:</h3>
                    <div class="word-options">
                        ${words.map(word => 
                            `<button class="word-btn" onclick="selectWord('${word}')">${word}</button>`
                        ).join('')}
                    </div>
                `;
                break;
            case 'guess':
                console.log('Processing guess:', message.data);
                break;
            case 'gameError':
                console.log('Processing gameError:', message.data);
                alert(message.data.error);
                break;
            case 'turnEnd':
                console.log('Processing turnEnd:', message.data);
                currentDrawerId = message.data.nextDrawerId;
                currentWord = null;

                // Clear canvas
                if (drawingCanvas) {
                    drawingCanvas.clearCanvas();
                    drawingCanvas.ctx.beginPath();
                }

                // Show notification in chat
                const notification = document.createElement('div');
                notification.className = 'correct-guess-notification';
                notification.textContent = message.data.timedOut
                    ? `⏰ Time's up! No one guessed in time.`
                    : `✅ ${message.data.guesserName} guessed correctly!`;
                const chatDiv = document.querySelector('.chat');
                if (chatDiv) chatDiv.prepend(notification);

                updateGameUI();

                if (message.data.scores) {
                    currentPlayers = message.data.scores;
                    updateGamePlayerList();
                }
                break;
            case 'clearCanvas':
            console.log('clearCanvas message received');
            if (message.userId !== currentUserId && drawingCanvas) {
                drawingCanvas.clearCanvas();
                drawingCanvas.ctx.beginPath();
            }
                break;
            case 'gameOver':
                console.log('Processing gameOver:', message.data);
                if (drawingCanvas) {
                    drawingCanvas.clearCanvas();
                }
                document.querySelector('.game-container').innerHTML = `
                    <div class="game-over">
                        <h1>Game Over!</h1>
                        <button onclick="window.location.href='/'">Play Again</button>
                    </div>
                `;
                break;
            case 'timerStart':
                const deadline = message.data.deadline * 1000;

                if (countdownInterval) clearInterval(countdownInterval);

                countdownInterval = setInterval(() => {
                    const now = Date.now();
                    const remaining = Math.ceil((deadline - now) / 1000);
                    const timerEl = document.getElementById('timer');

                    if (remaining <= 0) {
                        clearInterval(countdownInterval);
                        if (timerEl) timerEl.textContent = '0';
                    } else {
                        if (timerEl) timerEl.textContent = remaining;
                    }
                }, 100);
                break;
        }

        if (message.type === 'draw' && drawingCanvas) {
            console.log('Draw event - message.userId:', message.userId, 'currentUserId:', currentUserId);
            if (message.userId !== currentUserId) {
                handleDrawEvent(message.data);    
            }
        }
    };

    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
    };

    ws.onclose = function(event) {
        console.log('WebSocket closed, code:', event.code, 'reason:', event.reason);
        // Try to reconnect if we're in a game room
        if (window.location.pathname === '/game' && !event.wasClean) {
            console.log('Attempting to reconnect...');
            setTimeout(() => {
                connectWebSocket();
            }, 2000);
        }
    };
}   

window.addEventListener('load', connectWebSocket);

function handleDrawEvent(data) {
    const { action, x, y, color, size } = data;

    switch (action) {
        case 'start':
            drawingCanvas.ctx.strokeStyle = color;
            drawingCanvas.ctx.lineWidth = size;
            drawingCanvas.ctx.beginPath();
            drawingCanvas.ctx.moveTo(x, y);
            break;
        case 'draw':
            drawingCanvas.ctx.lineTo(x, y);
            drawingCanvas.ctx.stroke();
            break;
        case 'stop':
            drawingCanvas.ctx.closePath();
            drawingCanvas.ctx.beginPath();
            break;
    }
}