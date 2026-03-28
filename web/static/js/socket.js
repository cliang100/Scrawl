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

        if (message.userId) {
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
                window.location.href = `/game?room=${message.data.roomCode}&name=${encodeURIComponent(name)}`;
                break;
            case 'gameStateUpdate':
                console.log('Processing gameStateeUpdate:', message.data);
                handleGameStateUpdate(message.data);
                break;
            case 'wordSelected':
                console.log('Processing wordSelected:', message.data);
                currentWord = message.data.word;
                currentDrawerId = message.data.drawerID;
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
                if (window.wordSelectionOverlay) {
                    const words = message.data.words;
                    const modal = window.wordSelectionOverlay.querySelector('.word-selection-modal');
                    modal.innerHTML = `
                        <h3>Choose a word to draw:</h3>
                        <div class="word-options">
                            ${words.map(word => 
                                `<button class="word-btn" onclick="selectWord('${word}')">${word}</button>`
                            ).join('')}
                        </div>
                    `;
                }
                break;
            case 'guess':
                console.log('Processing guess:', message.data);
                const guess = message.data.guess;
                const isCorrect = guess.toLowerCase() === currentWord.toLowerCase();

                if (isCorrect) {
                    alert (`🎉 ${message.data.userName} guessed correctly! The word was "${currentWord}"`);
                }
                break;
            case 'gameError':
                console.log('Processing gameError:', message.data);
                alert(message.data.error);
                break;
        }

        if (message.type === 'draw' && drawingCanvas) {
            handleDrawEvent(message.data);
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
            break;
    }
}

window.addEventListener('load', connectWebSocket);