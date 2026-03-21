class DrawingCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.isDrawing = false;
        this.currentColor = '#000000';
        this.currentSize = 2;
        
        this.setupCanvas();
        this.setupEventListeners();
    }
    
    setupCanvas() {
        // Set canvas size
        this.canvas.width = 800;
        this.canvas.height = 600;
        
        // Set default styles
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        // Clear canvas with white background
        this.clearCanvas();
    }
    
    setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseout', () => this.stopDrawing());
        
        // Touch events for mobile
        this.canvas.addEventListener('touchstart', (e) => this.handleTouch(e, 'start'));
        this.canvas.addEventListener('touchmove', (e) => this.handleTouch(e, 'move'));
        this.canvas.addEventListener('touchend', () => this.stopDrawing());
    }

    handleTouch(e, type) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent(type === 'start' ? 'mousedown' : 'mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    this.canvas.dispatchEvent(mouseEvent);
    }
    
    startDrawing(e) {
        this.isDrawing = true;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        
        // Send drawing start event
        this.sendDrawEvent('start', x, y);
    }
    
    draw(e) {
        if (!this.isDrawing) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineWidth = this.currentSize;
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
        
        // Send drawing event
        this.sendDrawEvent('draw', x, y);
    }
    
    stopDrawing() {
        if (this.isDrawing) {
            this.isDrawing = false;
            this.sendDrawEvent('stop', 0, 0);
        }
    }
    
    sendDrawEvent(type, x, y) {
        if (window.ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'draw',
                data: {
                    action: type,
                    x: x,
                    y: y,
                    color: this.currentColor,
                    size: this.currentSize
                }
            }));
        }
    }
    
    clearCanvas() {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    setColor(color) {
        this.currentColor = color;
    }
    
    setSize(size) {
        this.currentSize = size;
    }
}

// Initialize canvas when page loads
let drawingCanvas;
window.addEventListener('load', () => {
    drawingCanvas = new DrawingCanvas('drawingCanvas');
    
    // Setup tool event listeners
    document.getElementById('colorPicker').addEventListener('change', (e) => {
        drawingCanvas.setColor(e.target.value);
    });
    
    document.getElementById('brushSize').addEventListener('input', (e) => {
        const size = e.target.value;
        drawingCanvas.setSize(size);
        document.getElementById('sizeDisplay').textContent = size;
    });
    
    document.getElementById('clearCanvas').addEventListener('click', () => {
        drawingCanvas.clearCanvas();
    });
});