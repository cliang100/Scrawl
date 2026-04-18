class DrawingCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.isDrawing = false;
        this.currentColor = '#000000';
        this.currentSize = 2;
        
        this.setupCanvas();
        this.setupEventListeners();

        this.strokes = [];
    }
    
    setupCanvas() {
        setTimeout(() => {
            const rect = this.canvas.getBoundingClientRect();
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;
            this.clearCanvas();
        }, 100);
        
        
        // Set default styles
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
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
        if (currentDrawerId !== currentUserId || !currentWord) {
            return;
        }

        this.strokes.push({
            points: [],
            color: this.currentColor,
            size: this.currentSize
        })
        this.isDrawing = true;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        
        this.strokes[this.strokes.length - 1].points.push({x, y});

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
        
        this.strokes[this.strokes.length - 1].points.push({x, y});

        this.sendDrawEvent('draw', x, y);
    }
    
    stopDrawing() {
        if (this.isDrawing) {
            this.isDrawing = false;
            this.sendDrawEvent('stop', 0, 0);
        }
    }
    
    sendDrawEvent(type, x, y) {
        if (ws && ws.readyState === WebSocket.OPEN) {
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

    replayStrokes() {
        this.strokes.forEach(stroke => {
            this.ctx.strokeStyle = stroke.color;
            this.ctx.lineWidth = stroke.size;
            this.ctx.beginPath();
            stroke.points.forEach((point, index) => {
                if (index === 0) {
                    this.ctx.moveTo(point.x, point.y);
                } else {
                    this.ctx.lineTo(point.x, point.y);
                }
            });
            this.ctx.stroke();
        });
    }

    undoLastStroke(skipBroadcast = false) {
        if (this.strokes.length === 0) return; 
        this.strokes.pop();
        this.clearCanvas();
        this.replayStrokes();

        if (!skipBroadcast && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'undoStroke', data: {} }));
        }
    }
}

// Initialize canvas when page loads
let drawingCanvas;
window.addEventListener('load', () => {
    drawingCanvas = new DrawingCanvas('drawingCanvas');
    
    // Color palette selection
    const colorOptions = document.querySelectorAll('.color-option');
    colorOptions.forEach(option => {
        option.addEventListener('click', () => {
            const color = option.dataset.color;
            drawingCanvas.setColor(color);

            colorOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
        });
    });

    // Set initial color to black
    const initialColor = document.querySelector('.color-option[data-color="#000000"]');
    if (initialColor) {
        initialColor.classList.add('selected');
        drawingCanvas.setColor('#000000');
    }
    
    // Brush picker dropdown logic
    const brushTrigger = document.getElementById('brushTrigger');
    const brushOptions = document.querySelector('.brush-options');
    const brushOptionElements = document.querySelectorAll('.brush-option');

    // Set initial size to Medium-Thin (5)
    drawingCanvas.setSize(5);

    // Toggle dropdown
    brushTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        brushOptions.classList.toggle('open');
    });

    // Handle option selection
    brushOptionElements.forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            const size = parseInt(option.dataset.size);
            drawingCanvas.setSize(size);

            // Update selection state
            brushOptionElements.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');

            // Update brush icon size to match selection
            const brushIcon = document.querySelector('.brush-icon');
            if (brushIcon) {
                brushIcon.setAttribute('data-size', size);
            }

            // CLose dropdown
            brushOptions.classList.remove('open');
        });
    });

    // Clear canvas button
    document.getElementById('clearCanvas').addEventListener('click', () => {
        drawingCanvas.clearCanvas();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'clearCanvas', data: {} }));
        }
    });

    // Undo last stroke button
    document.getElementById('undoStroke').addEventListener('click', () => {
        drawingCanvas.undoLastStroke();
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        brushOptions.classList.remove('open');
    });
});

window.addEventListener('resize', () => {
    if (drawingCanvas) {
        const rect = drawingCanvas.canvas.getBoundingClientRect();
        drawingCanvas.canvas.width = rect.width;
        drawingCanvas.canvas.height = rect.height;
        drawingCanvas.clearCanvas();
    }
});