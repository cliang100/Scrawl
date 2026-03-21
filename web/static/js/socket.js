let ws;

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const roomId = 'test-room';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/${roomId}`);

    ws.onopen = function(event) {
        console.log('WebSocket connected');
        ws.send(JSON.stringify({
            type: 'chat',
            data: 'Hello from client!'
        }));
    };

    ws.onmessage = function(event) {
        const message = JSON.parse(event.data);
        console.log('Message from server:', message);

        if (message.type === 'draw' && drawingCanvas) {
            handleDrawEvent(message.data);
        }
    };

    ws.onclose = function(event) {
        console.log('WebSocket disconnected');
    };

    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
}   

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