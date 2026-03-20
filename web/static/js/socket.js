let ws;

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = function(event) {
        console.log('WebSocket connected');
        ws.send('Hello from client!');
    };

    ws.onmessage = function(event) {
        console.log('Message from server:', event.data);
    };

    ws.onclose = function(event) {
        console.log('WebSocket disconnected');
    };

    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
}   

window.addEventListener('load', connectWebSocket);