let ws;
let isWinner = false;

function connectWebSocket() {
    const urlParams = new URLSearchParams(window.location.search);
    let roomCode = urlParams.get('room');
    
    // If no query param, try path format (e.g., /ABC123)
    if (!roomCode) {
        const path = window.location.pathname;
        const pathCode = path.substring(1); // Remove leading /
        if (pathCode && pathCode !== '' && pathCode !== 'game' && pathCode !== 'lobby') {
            roomCode = pathCode;
        }
    }

    console.log('Room code from URL:', roomCode);

    if (roomCode) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws/${roomCode}`);
    } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    }

    ws.onopen = function() {
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

        // Route lobby messages to handleLobbyMessage if overlay exists
        const lobbyMessageTypes = ['roomUpdated', 'settingsUpdated', 'gameStarted', 'roomError'];
        const overlay = document.getElementById('lobbyOverlay');
        if (lobbyMessageTypes.includes(message.type) && overlay && !overlay.classList.contains('hidden')) {
            handleLobbyMessage(event);
            return;
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
                console.log('gameStarted received');
                // Lobby overlay handles this via handleLobbyMessage
                break;
            case 'gameStateUpdate':
                console.log('Processing gameStateUpdate:', message.data);
                handleGameStateUpdate(message.data);
                break;
            case 'drawingNow':
                console.log('Processing drawingNow:', message.data);
                const drawingChatDiv = document.querySelector('.message-list');
                if (drawingChatDiv) {
                    const drawMsg = document.createElement('div');
                    drawMsg.className = 'drawing-message';
                    drawMsg.textContent = `${message.data.drawerName} is drawing now!`;
                    drawingChatDiv.appendChild(drawMsg);
                    drawingChatDiv.scrollTop = drawingChatDiv.scrollHeight;
                }
                break;
            case 'wordSelected':
                console.log('Processing wordSelected:', message.data);
                // Only update currentWord if word is provided (drawer gets direct message with word)
                if (message.data.word) {
                    currentWord = message.data.word;
                }
                console.log('currentWord set to:', currentWord);
                currentDrawerId = message.data.drawerID;
                // Drawer is considered a "winner" for chat purposes
                if (currentDrawerId === currentUserId) {
                    isWinner = true;
                    console.log('Drawer set isWinner to true');
                }
                wordLength = message.data.word ? message.data.word.length : message.data.wordLength;
                revealedLetters = [];
                hideWordSelection();
                updateGameUI();
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
                console.log('Processing guess:', message.data, 'local isWinner:', isWinner);

                // Track local winner status
                if (message.data.isCorrect && message.data.userId === currentUserId) {
                    isWinner = true;
                    console.log('Set isWinner to true for current user');
                }

                const chatDiv = document.querySelector('.message-list');
                if (chatDiv) {
                    const msgDiv = document.createElement('div');

                    if (message.data.displayText) {
                        msgDiv.textContent = message.data.displayText;
                        msgDiv.className = 'guess-message system-message';
                    } else if (message.data.guess) {
                        msgDiv.textContent = message.data.userName + ': ' + message.data.guess;
                        console.log('Message from:', message.data.userName, 'isWinnerChat:', message.data.isWinnerChat, 'local isWinner:', isWinner);
                        if (message.data.isWinnerChat && isWinner) {
                            msgDiv.className = 'guess-message winner-chat';
                            console.log('Showing winner chat');
                        } else if (!message.data.isWinnerChat) {
                            msgDiv.className = 'guess-message';
                        } else {
                            // Skip winner chat from non-winners entirely
                            console.log('Hiding winner chat from non-winner');
                            msgDiv.style.display = 'none';
                        }
                    }

                    chatDiv.appendChild(msgDiv);
                    chatDiv.scrollTop = chatDiv.scrollHeight;
                }
                break;
            case 'gameError':
                console.log('Processing gameError:', message.data);
                alert(message.data.error);
                break;
            case 'fill':
                if (message.userId !== currentUserId && drawingCanvas) {
                    drawingCanvas.floodFill(
                        message.data.x,
                        message.data.y,
                        message.data.color
                    );
                }
                break;
            case 'turnEnd':
                console.log('Processing turnEnd:', message.data);
                isWinner = false;
                currentDrawerId = message.data.nextDrawerId;
                currentWord = null;

                // Clear canvas and stroke history
                if (drawingCanvas) {
                    drawingCanvas.clearCanvas();
                    drawingCanvas.strokes = [];
                    drawingCanvas.ctx.beginPath();
                }

                // Show timeout notification at bottom of chat only
                if (message.data.timedOut) {
                    const notification = document.createElement('div');
                    notification.className = 'system-message timeout-message';
                    notification.textContent = `⏰ Time's up! No one guessed in time.`;
                    const turnEndChatDiv = document.querySelector('.message-list');
                    if (turnEndChatDiv) {
                        turnEndChatDiv.appendChild(notification);
                        turnEndChatDiv.scrollTop = turnEndChatDiv.scrollHeight;
                    }
                }

                updateGameUI();

                const roundDisplay = document.getElementById('roundDisplay');
                if (roundDisplay && message.data.round && message.data.maxRounds) {
                    roundDisplay.textContent = `Round ${message.data.round} of ${message.data.maxRounds}`;
                }

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
                
                if (!window.gameOverOverlay) {
                    const overlay = document.createElement('div');
                    overlay.className = 'game-over-overlay';
                    document.body.appendChild(overlay);
                    window.gameOverOverlay = overlay;
                }

                const scores = message.data.scores || [];
                const winner = scores.length > 0 ? scores[0] : null;

                window.gameOverOverlay.innerHTML = `
                    <div class="game-over-modal">
                        <h2>🎉 Game Over!</h2>
                        ${winner ? `<p><strong>${winner.name}</strong> wins with ${winner.score} points!</p>` : ''}
                        <button onclick="window.location.href='/'" style="margin-top: 20px;">Play Again</button>
                    </div>
                `;
                window.gameOverOverlay.style.display = 'flex';
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
            case 'undoStroke':
                if (message.userId !== currentUserId) {
                    drawingCanvas.undoLastStroke(true);
                }
                break;
            case 'hint':
                handleHint(message.data);
                break;
        }

        if (message.type === 'draw' && drawingCanvas) {
            console.log('Draw event - message.userId:', message.userId, 'currentUserId:', currentUserId);
            if (message.userId !== currentUserId) {
                handleDrawEvent(message.data);    
            }
        }

        if (message.type === 'stroke' && drawingCanvas) {
            if (message.userId !== currentUserId) {
                handleStrokeEvent(message.data, message.userId);
            }
        }
    };

    let lastStrokePoint = null;
    let lastStrokeId = null;

    function handleStrokeEvent(data, userId) {
        const { strokeId, points, color, size } = data;
        if (!points || points.length === 0) return;

        const isNewStroke = strokeId !== lastStrokeId;
        lastStrokeId = strokeId;

        if (isNewStroke) {
            drawingCanvas.strokes.push({ points: [], color, size });
            drawingCanvas.ctx.beginPath();
            drawingCanvas.ctx.moveTo(points[0].x, points[0].y);
        } else {
            drawingCanvas.ctx.moveTo(lastStrokePoint.x, lastStrokePoint.y);
        }

        drawingCanvas.ctx.strokeStyle = color;
        drawingCanvas.ctx.lineWidth = size;
        drawingCanvas.ctx.lineCap = 'round';
        drawingCanvas.ctx.lineJoin = 'round';

        points.forEach(p => drawingCanvas.ctx.lineTo(p.x, p.y));
        drawingCanvas.ctx.stroke();

        drawingCanvas.strokes[drawingCanvas.strokes.length - 1].points.push(...points);
        lastStrokePoint = points[points.length - 1];
    }

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

function sendFill(x, y, color) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'fill',
            data: { x, y, color }
        }));
    }
}

window.addEventListener('load', connectWebSocket);

function handleHint(data) {
    const { index, letter } = data;
    revealedLetters[index] = letter;
    updateWordDisplay();
}

function handleDrawEvent(data) {
    const { action, x, y, color, size } = data;

    switch (action) {
        case 'start':
            lastStrokePoint = null; // Reset to prevent connecting to previous stroke
            drawingCanvas.ctx.strokeStyle = color;
            drawingCanvas.ctx.lineWidth = size;
            drawingCanvas.ctx.lineCap = 'round';
            drawingCanvas.ctx.lineJoin = 'round';
            // Don't add to strokes array here - stroke batches will add it
            drawingCanvas.ctx.beginPath();
            drawingCanvas.ctx.moveTo(x, y);
            break;
        case 'draw':
            if (drawingCanvas.strokes.length > 0) {
                drawingCanvas.strokes[drawingCanvas.strokes.length - 1].points.push({x, y});
            }
            drawingCanvas.ctx.lineTo(x, y);
            drawingCanvas.ctx.stroke();
            break;
        case 'stop':
            drawingCanvas.ctx.closePath();
            drawingCanvas.ctx.beginPath();
            break;
    }
}