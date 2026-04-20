class DrawingCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.isDrawing = false;
        this.currentTool = 'pen';
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

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (this.currentTool === 'fill') {
            this.floodFill(x, y, this.currentColor);
            sendFill(x, y, this.currentColor);
            return;
        }

        this.strokes.push({
            points: [],
            color: this.currentColor,
            size: this.currentSize
        })
        this.isDrawing = true;

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

    setTool(tool) {
        this.currentTool = tool;
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

    floodFill(startX, startY, fillColor) {
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const data = imageData.data;
        const width = this.canvas.width;
        const height = this.canvas.height;

        const startIdx = (Math.floor(startY) * width + Math.floor(startX)) * 4;
        const targetR = data[startIdx];
        const targetG = data[startIdx + 1];
        const targetB = data[startIdx + 2];
        const targetA = data[startIdx + 3];

        const fillRgb = this.hexToRgb(fillColor);
        if (!fillRgb) return;

        if (targetR === fillRgb.r && targetG === fillRgb.g &&
            targetB === fillRgb.b && targetA === 255) {
            return;
        }

        const stack = [[Math.floor(startX), Math.floor(startY)]];
        const tolerance = 32;

        while (stack.length > 0) {
            const [x, y] = stack.pop();

            if (x < 0 || x >= width || y < 0 || y >= height) continue;

            const idx = (y * width + x) * 4;
            const r = data[idx], g = data[idx + 1],
                  b = data[idx + 2], a = data[idx + 3];

            if (Math.abs(r - targetR) > tolerance ||
                Math.abs(g - targetG) > tolerance ||
                Math.abs(b - targetB) > tolerance ||
                Math.abs(a - targetA) > tolerance) {
                continue;
            }

            if (r === fillRgb.r && g === fillRgb.g &&
                b === fillRgb.b && a === 255) {
                continue;
            }

            data[idx] = fillRgb.r;
            data[idx + 1] = fillRgb.g;
            data[idx + 2] = fillRgb.b;
            data[idx + 3] = 255;

            stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }

        this.ctx.putImageData(imageData, 0, 0);

        this.strokes.push({
            type: 'fill',
            x: startX,
            y: startY,
            color: fillColor
        });
    }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
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

    // Fill tool button
    const fillToolBtn = document.getElementById('fillTool');
    if (fillToolBtn) {
        fillToolBtn.addEventListener('click', () => {
            drawingCanvas.setTool('fill');
            document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('selected'));
            fillToolBtn.classList.add('selected');
        });
    }

    // Pen tool (default)
    const penToolBtn = document.getElementById('penTool') || document.querySelector('.pen-tool');
    if (penToolBtn) {
        penToolBtn.addEventListener('click', () => {
            drawingCanvas.setTool('pen');
            document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('selected'));
            penToolBtn.classList.add('selected');
        });
    }
    
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