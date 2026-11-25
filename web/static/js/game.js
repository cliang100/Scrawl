const roomCode = window.location.pathname.slice(1);
const RECONNECT_DELAY_MS = 2000;

let ws = null;
let myId = null;
let players = [];
let settings = { rounds: 3, drawTime: 80 };
let game = null; // last gameStateUpdate, or null in the lobby
let countdown = null;
let leaving = false;

const $ = id => document.getElementById(id);
const me = () => players.find(p => p.id === myId);
const isHost = () => Boolean(me()?.isHost);
const isDrawer = () => game !== null && game.currentDrawerId === myId;
const canDraw = () => isDrawer() && game.state === 'drawing';

function connect() {
    ws = openSocket();
    ws.onopen = () => {
        sendMessage(ws, 'joinRoom', {
            roomCode,
            token: loadToken(roomCode),
            name: localStorage.getItem('scrawl_name') || '',
            avatar: localStorage.getItem('scrawl_avatar') || '🎨',
        });
    };
    ws.onmessage = event => {
        const { type, data } = JSON.parse(event.data);
        handlers[type]?.(data);
    };
    ws.onclose = () => {
        if (leaving) return;
        showToast('Connection lost, reconnecting...', 'error');
        setTimeout(connect, RECONNECT_DELAY_MS);
    };
}

function leave(url) {
    leaving = true;
    window.location.href = url;
}

const handlers = {
    roomJoined(data) {
        myId = data.playerId;
        players = data.players;
        saveToken(roomCode, data.token);
        applySettings(data.settings);
        renderPlayers();
        renderLobby();
    },

    roomError(data) {
        clearToken(roomCode);
        leaving = true;
        showToast(data.error, 'error');
        const target = data.error === 'room not found' ? '/' : `/?room=${roomCode}`;
        setTimeout(() => leave(target), 1500);
    },

    roomUpdated(data) {
        players = data.players;
        renderPlayers();
        renderLobby();
    },

    settingsUpdated: applySettings,

    gameError(data) {
        showToast(data.error, 'error');
    },

    gameStarted(data) {
        players = data.players;
        closeOverlay();
        $('messageList').replaceChildren();
    },

    gameStateUpdate(data) {
        game = data;
        players = data.players;
        $('roundDisplay').textContent = `Round ${data.round} of ${data.maxRounds}`;
        startCountdown(data.remainingMs);
        drawingCanvas.load(data.canvas || []);
        renderLobby();
        renderPlayers();
        renderWord();
        renderTools();
        if (data.choices) showWordChoices(data.choices);
        else closeOverlay();
    },

    drawingNow(data) {
        addMessage(`${data.drawerName} is drawing now!`, 'drawing-message');
    },

    hint(data) {
        game.mask = data.mask;
        renderWord();
    },

    guess(data) {
        if (data.displayText) {
            addMessage(data.displayText, 'guess-message system-message');
        } else {
            addMessage(`${data.userName}: ${data.guess}`, `guess-message${data.isWinnerChat ? ' winner-chat' : ''}`);
        }
    },

    turnEnd(data) {
        if (data.timedOut) addMessage("⏰ Time's up!", 'system-message timeout-message');
        if (data.word) addMessage(`The word was "${data.word}".`, 'system-message');
    },

    gameOver(data) {
        game = null;
        clearInterval(countdown);
        $('timer').textContent = '--';
        drawingCanvas.load([]);
        renderWord();
        renderTools();
        renderPlayers();
        renderLobby();
        showGameOver(data.scores);
    },

    stroke: data => drawingCanvas.apply({ ...data, type: 'stroke' }),
    fill: data => drawingCanvas.apply({ ...data, type: 'fill' }),
    undoStroke: () => drawingCanvas.undo(),
    clearCanvas: () => drawingCanvas.load([]),
};

function addMessage(text, className) {
    const list = $('messageList');
    list.appendChild(el('div', className, text));
    list.scrollTop = list.scrollHeight;
}

function startCountdown(remainingMs) {
    const deadline = performance.now() + remainingMs;
    const tick = () => {
        $('timer').textContent = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    };
    clearInterval(countdown);
    tick();
    countdown = setInterval(tick, 200);
}

function renderPlayers() {
    const ranked = [...players].sort((a, b) => b.score - a.score);
    const boxes = ranked.map((player, i) => {
        const drawing = game?.currentDrawerId === player.id;
        const box = el('div', `player-box${i % 2 ? ' alt-row' : ''}${drawing ? ' current-drawer' : ''}`);
        const rank = ranked.findIndex(p => p.score === player.score) + 1;

        const info = el('div', 'player-info');
        const name = el('div', 'player-name', player.name);
        if (player.id === myId) name.append(' ', el('span', 'you-tag', '(You)'));
        if (drawing) name.append(' ✏️');
        info.append(name, el('div', 'player-score', `${player.score} points`));

        box.append(
            el('div', 'player-rank', `#${rank}`),
            el('div', player.isHost ? 'player-host' : 'player-host-placeholder', player.isHost ? '👑' : ''),
            info,
            el('div', 'player-avatar', player.avatar),
        );
        return box;
    });
    $('gamePlayerList').replaceChildren(...boxes);
}

function renderLobby() {
    const overlay = $('lobbyOverlay');
    overlay.classList.toggle('hidden', game !== null);
    overlay.classList.toggle('is-guest', !isHost());
    $('waitingMessage').style.display = isHost() ? 'none' : 'block';
    for (const button of overlay.querySelectorAll('.dropdown-value')) button.disabled = !isHost();

    const start = $('startGameBtn');
    start.disabled = players.length < 2;
    start.title = start.disabled ? 'Need at least 2 players' : 'Start the game!';
}

function applySettings(next) {
    settings = next;
    $('roundsValue').textContent = settings.rounds;
    $('drawTimeValue').textContent = `${settings.drawTime}s`;
    if (!game) $('roundDisplay').textContent = `Round 1 of ${settings.rounds}`;
}

function renderWord() {
    const display = $('wordDisplay');
    const label = display.querySelector('.word-label');
    const content = display.querySelector('.word-content');
    const count = display.querySelector('.letter-count');
    const guessing = game?.state === 'drawing' && !isDrawer();

    display.classList.toggle('waiting', game?.state !== 'drawing');
    count.style.display = guessing ? 'inline-block' : 'none';
    if (guessing) {
        label.textContent = 'GUESS THIS';
        // a non-breaking space keeps word gaps visible
        content.textContent = [...game.mask].map(c => (c === ' ' ? ' ' : c)).join(' ');
        count.textContent = game.mask.replaceAll(' ', '').length;
    } else if (game?.state === 'drawing') {
        label.textContent = 'DRAW THIS';
        content.textContent = game.word;
    } else {
        label.textContent = '';
        content.textContent = 'WAITING';
    }
}

function renderTools() {
    $('drawingCanvas').style.pointerEvents = canDraw() ? 'auto' : 'none';
    document.querySelector('.toolbar').style.display = canDraw() ? 'flex' : 'none';
}

function showOverlay(className, modal) {
    closeOverlay();
    const overlay = el('div', className);
    overlay.id = 'gameOverlay';
    overlay.append(modal);
    document.body.append(overlay);
    modal.querySelector('button')?.focus();
}

function closeOverlay() {
    $('gameOverlay')?.remove();
}

function showWordChoices(choices) {
    const modal = el('div', 'word-selection-modal');
    const options = el('div', 'word-options');
    for (const word of choices) {
        const button = el('button', 'word-btn', word);
        button.addEventListener('click', () => sendMessage(ws, 'selectWord', { word }));
        options.append(button);
    }
    modal.append(el('h3', '', 'Choose a word to draw:'), options);
    showOverlay('word-selection-overlay', modal);
}

function showGameOver(scores) {
    const modal = el('div', 'game-over-modal');
    modal.append(el('h2', '', '🎉 Game Over!'));
    const top = scores[0];
    const winners = scores.filter(p => p.score === top.score).map(p => p.name);
    modal.append(el('p', '', `${winners.join(' and ')} ${winners.length > 1 ? 'tie' : 'wins'} with ${top.score} points!`));
    const again = el('button', '', 'Back to lobby');
    again.addEventListener('click', closeOverlay);
    modal.append(again);
    showOverlay('game-over-overlay', modal);
}

function setupDropdown(name, setting) {
    const dropdown = $(`${name}Dropdown`);
    const menu = dropdown.querySelector('.dropdown-menu');
    dropdown.querySelector('.dropdown-value').addEventListener('click', event => {
        event.stopPropagation();
        const open = menu.classList.contains('hidden');
        closeDropdowns();
        menu.classList.toggle('hidden', !open);
    });
    for (const item of dropdown.querySelectorAll('.dropdown-item')) {
        item.addEventListener('click', () => {
            sendMessage(ws, 'updateSettings', { ...settings, [setting]: Number(item.dataset.value) });
        });
    }
}

function closeDropdowns() {
    for (const menu of document.querySelectorAll('.dropdown-menu')) menu.classList.add('hidden');
}

$('lobbyRoomCode').textContent = roomCode;
setupDropdown('rounds', 'rounds');
setupDropdown('drawTime', 'drawTime');
document.addEventListener('click', closeDropdowns);

$('startGameBtn').addEventListener('click', () => sendMessage(ws, 'startGame'));

$('copyCodeBtn').addEventListener('click', async () => {
    const invite = `${window.location.origin}/?room=${roomCode}`;
    try {
        await navigator.clipboard.writeText(invite);
        showToast('Invite link copied!', 'success');
    } catch {
        showToast(invite);
    }
});

$('guessInput').addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    const guess = event.target.value.trim();
    if (!guess) return;
    sendMessage(ws, 'guess', { guess });
    event.target.value = '';
});

const drawingCanvas = new DrawingCanvas($('drawingCanvas'), canDraw, (type, data) => sendMessage(ws, type, data));
setupToolbar(drawingCanvas);
renderTools();

// Without a name or a seat, pick a character first.
if (!loadToken(roomCode) && !localStorage.getItem('scrawl_name')) {
    leave(`/?room=${roomCode}`);
} else {
    connect();
}
