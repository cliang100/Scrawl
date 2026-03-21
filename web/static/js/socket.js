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
    };

    ws.onclose = function(event) {
        console.log('WebSocket disconnected');
    };

    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
}   

window.addEventListener('load', connectWebSocket);