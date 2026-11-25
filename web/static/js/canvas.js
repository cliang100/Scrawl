// Every client uses the same 800x600 coordinates; CSS scales the element.
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const FLUSH_MS = 50;
const MAX_BATCH = 20;
const FILL_TOLERANCE = 32;

class DrawingCanvas {
    constructor(canvas, canDraw, send) {
        this.canvas = canvas;
        this.canDraw = canDraw;
        this.send = send;
        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;
        this.ctx = canvas.getContext('2d', { willReadFrequently: true });
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        this.color = '#000000';
        this.size = 5;
        this.tool = 'pen';
        this.strokeId = null;
        this.pending = [];
        this.flushTimer = null;
        this.load([]);

        canvas.addEventListener('pointerdown', e => this.start(e));
        canvas.addEventListener('pointermove', e => this.move(e));
        canvas.addEventListener('pointerup', () => this.stop());
        canvas.addEventListener('pointercancel', () => this.stop());
    }

    position(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
        const y = ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;
        return {
            x: Math.round(Math.min(Math.max(x, 0), CANVAS_WIDTH) * 10) / 10,
            y: Math.round(Math.min(Math.max(y, 0), CANVAS_HEIGHT) * 10) / 10,
        };
    }

    start(e) {
        if (!this.canDraw() || e.button !== 0) return;
        const point = this.position(e);
        if (this.tool === 'fill') {
            const op = { points: [point], color: this.color };
            this.apply({ ...op, type: 'fill' });
            this.send('fill', op);
            return;
        }
        this.canvas.setPointerCapture(e.pointerId);
        this.strokeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.addPoint(point);
    }

    move(e) {
        if (this.strokeId === null) return;
        if (!this.canDraw()) {
            this.stop();
            return;
        }
        this.addPoint(this.position(e));
    }

    stop() {
        this.flush();
        this.strokeId = null;
    }

    addPoint(point) {
        this.apply({ type: 'stroke', strokeId: this.strokeId, points: [point], color: this.color, size: this.size });
        this.pending.push(point);
        if (this.pending.length >= MAX_BATCH) {
            this.flush();
        } else if (this.flushTimer === null) {
            this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
        }
    }

    flush() {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
        if (this.pending.length === 0) return;
        this.send('stroke', { strokeId: this.strokeId, points: this.pending, color: this.color, size: this.size });
        this.pending = [];
    }

    // load replaces the drawing with a list of operations.
    load(ops) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
        this.pending = [];
        this.strokeId = null;
        this.ops = [];
        this.wipe();
        for (const op of ops) this.apply(op);
    }

    // apply draws one operation and remembers it for undo.
    apply(op) {
        const last = this.ops.at(-1);
        if (op.type === 'stroke' && last?.type === 'stroke' && last.strokeId === op.strokeId) {
            this.drawLine([last.points.at(-1), ...op.points], op);
            last.points.push(...op.points);
            return;
        }
        this.ops.push({ ...op, points: [...op.points] });
        this.draw(op);
    }

    draw(op) {
        if (op.type === 'fill') this.floodFill(op.points[0], op.color);
        else this.drawLine(op.points, op);
    }

    drawLine(points, { color, size }) {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = size;
        this.ctx.beginPath();
        this.ctx.moveTo(points[0].x, points[0].y);
        for (const p of points) this.ctx.lineTo(p.x, p.y);
        this.ctx.stroke();
    }

    undo() {
        this.ops.pop();
        this.wipe();
        for (const op of this.ops) this.draw(op);
    }

    wipe() {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    floodFill(start, color) {
        const image = this.ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        const pixels = image.data;
        const startX = Math.min(Math.floor(start.x), CANVAS_WIDTH - 1);
        const startY = Math.min(Math.floor(start.y), CANVAS_HEIGHT - 1);
        const first = startY * CANVAS_WIDTH + startX;
        const target = pixels.slice(first * 4, first * 4 + 3);
        const fill = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));

        // seen matters when the fill colour is within tolerance of the target
        const seen = new Uint8Array(CANVAS_WIDTH * CANVAS_HEIGHT);
        const stack = [first];
        while (stack.length > 0) {
            const i = stack.pop();
            if (seen[i]) continue;
            seen[i] = 1;
            const p = i * 4;
            if (target.some((value, c) => Math.abs(pixels[p + c] - value) > FILL_TOLERANCE)) continue;
            pixels[p] = fill[0];
            pixels[p + 1] = fill[1];
            pixels[p + 2] = fill[2];

            const x = i % CANVAS_WIDTH;
            if (x > 0) stack.push(i - 1);
            if (x < CANVAS_WIDTH - 1) stack.push(i + 1);
            if (i >= CANVAS_WIDTH) stack.push(i - CANVAS_WIDTH);
            if (i < CANVAS_WIDTH * (CANVAS_HEIGHT - 1)) stack.push(i + CANVAS_WIDTH);
        }
        this.ctx.putImageData(image, 0, 0);
    }
}

function setupToolbar(drawing) {
    const select = (selector, chosen) => {
        for (const node of document.querySelectorAll(selector)) {
            node.classList.toggle('selected', node === chosen);
        }
    };

    for (const option of document.querySelectorAll('.color-option')) {
        option.addEventListener('click', () => {
            drawing.color = option.dataset.color;
            select('.color-option', option);
        });
    }
    select('.color-option', document.querySelector('.color-option[data-color="#000000"]'));

    const brushOptions = document.querySelector('.brush-options');
    document.getElementById('brushTrigger').addEventListener('click', e => {
        e.stopPropagation();
        brushOptions.classList.toggle('open');
    });
    document.addEventListener('click', () => brushOptions.classList.remove('open'));
    for (const option of document.querySelectorAll('.brush-option')) {
        option.addEventListener('click', () => {
            drawing.size = Number(option.dataset.size);
            select('.brush-option', option);
            const icon = document.querySelector('.brush-icon');
            icon.style.width = icon.style.height = `${Math.max(8, drawing.size * 1.5)}px`;
        });
    }

    for (const tool of ['pen', 'fill']) {
        const button = document.getElementById(`${tool}Tool`);
        button.addEventListener('click', () => {
            drawing.tool = tool;
            select('.tool-btn', button);
        });
    }

    document.getElementById('clearCanvas').addEventListener('click', () => {
        drawing.load([]);
        drawing.send('clearCanvas', {});
    });
    document.getElementById('undoStroke').addEventListener('click', () => {
        drawing.undo();
        drawing.send('undoStroke', {});
    });
}
