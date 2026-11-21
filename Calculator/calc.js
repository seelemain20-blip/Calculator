/* =====================================================================
   THE HERTA CALCULATOR — script.js
   Sections:
   1. State & Constants
   2. Math Engine (safe parser, no eval)
   3. Number & Expression Formatting
   4. Calculator Actions
   5. Rendering
   6. Button Feedback (ripple, press, equals glow)
   7. Event Handling (mouse, touch, keyboard)
   8. Particle System (stars, motes, sparkle bursts)
   9. Herta Gallery (random image per number click + card effects)
   10. Initialisation
   11. Key Animations (clear / delete / operators / equals)
   12. Interactive Background (orb parallax)
   13. Card Effects (3D tilt, zoom, parallax, hologram, motes)
   14. Cursor Trail
   15. Herta Special Ability
   ===================================================================== */

'use strict';


/* =====================================================================
   1. STATE & CONSTANTS
   ===================================================================== */
const MAX_NUMBER_LENGTH = 15;       // max characters in a single number
const MAX_EXPRESSION_LENGTH = 60;   // max characters in the whole expression
const OPERATORS = ['+', '-', '×', '÷'];

const state = {
    expression: '',        // internal expression, e.g. "12+3×4"
    previous: '',          // text for the small line (e.g. "12 + 3 × 4 =")
    justEvaluated: false,  // true right after "="
    errorMessage: '',
    lastOperation: null    // { operator, operand } used for repeated "="
};

// DOM references
const calculatorEl    = document.getElementById('calculator');
const displayEl       = document.getElementById('display');
const previousLineEl  = document.getElementById('previousLine');
const currentLineEl   = document.getElementById('currentLine');
const keysContainer   = document.getElementById('keys');
const keyButtons      = Array.from(keysContainer.querySelectorAll('.key'));

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function isOperator(character) {
    return OPERATORS.includes(character);
}


/* =====================================================================
   2. MATH ENGINE
   Recursive-descent parser. Respects order of operations:
     expression := term (('+' | '-') term)*
     term       := unary (('×' | '÷') unary)*
     unary      := ('-' | '+') unary | postfix
     postfix    := number '%'*
   Percent rule: "n%" = n / 100, and in "a + n%" or "a - n%"
   the percentage is taken of a (so 200 + 10% = 220).
   ===================================================================== */
function evaluate(expression) {
    let position = 0;
    let lastFactorWasPercent = false;

    function peek() {
        return expression[position];
    }

    function parseExpression() {
        let result = parseTerm().value;

        while (peek() === '+' || peek() === '-') {
            const operator = expression[position++];
            const term = parseTerm();
            let right = term.value;

            // "a + n%" means a + (a × n / 100)
            if (term.isBarePercent) {
                right = result * right;
            }

            result = operator === '+' ? result + right : result - right;
        }
        return result;
    }

    function parseTerm() {
        lastFactorWasPercent = false;
        let value = parseUnary();
        let isBarePercent = lastFactorWasPercent;

        while (peek() === '×' || peek() === '÷') {
            isBarePercent = false;
            const operator = expression[position++];
            const right = parseUnary();

            if (operator === '×') {
                value *= right;
            } else {
                if (right === 0) {
                    throw new Error('DIVIDE_BY_ZERO');
                }
                value /= right;
            }
        }
        return { value: value, isBarePercent: isBarePercent };
    }

    function parseUnary() {
        if (peek() === '-') {
            position++;
            return -parseUnary();
        }
        if (peek() === '+') {
            position++;
            return parseUnary();
        }
        return parsePostfix();
    }

    function parsePostfix() {
        let value = parseNumber();
        let percentCount = 0;

        while (peek() === '%') {
            position++;
            value /= 100;
            percentCount++;
        }
        lastFactorWasPercent = percentCount > 0;
        return value;
    }

    function parseNumber() {
        const match = /^(\d+\.?\d*|\.\d+)/.exec(expression.slice(position));
        if (!match) {
            throw new Error('SYNTAX');
        }
        position += match[0].length;
        return parseFloat(match[0]);
    }

    const finalValue = parseExpression();

    if (position !== expression.length) {
        throw new Error('SYNTAX');
    }
    return finalValue;
}


/* =====================================================================
   3. NUMBER & EXPRESSION FORMATTING
   ===================================================================== */

// Turns a numeric result into a clean string (fixes 0.1 + 0.2 = 0.30000000000000004)
function formatNumber(value) {
    if (!Number.isFinite(value)) {
        throw new Error('OVERFLOW');
    }

    const rounded = Number(value.toPrecision(12));
    if (rounded === 0) {
        return '0';
    }

    const absolute = Math.abs(rounded);
    if (absolute >= 1e21) {
        throw new Error('OVERFLOW');
    }
    if (absolute < 1e-6) {
        return rounded.toFixed(12).replace(/\.?0+$/, '');
    }
    return String(rounded);
}

// Adds spaces around operators for readability, e.g. "12+3" -> "12 + 3"
function formatExpression(expression) {
    let output = '';

    for (let i = 0; i < expression.length; i++) {
        const character = expression[i];

        if (isOperator(character)) {
            const isUnaryMinus = character === '-' && (i === 0 || isOperator(expression[i - 1]));
            const isUnaryPlus = character === '+' && (i === 0 || isOperator(expression[i - 1]));
            if (isUnaryMinus || isUnaryPlus) {
                output += character;
            } else {
                output += ' ' + (character === '-' ? '−' : character) + ' ';
            }
        } else {
            output += character;
        }
    }
    return output;
}

// Returns the number currently being typed (without a trailing %)
function getLastNumber(expression) {
    return /(\d*\.?\d*)$/.exec(expression)[1];
}

function stripTrailingOperators(expression) {
    let result = expression;
    while (result.length > 0 && isOperator(result.slice(-1))) {
        result = result.slice(0, -1);
    }
    return result;
}

// The most recent number in the expression, including its sign and % marks.
// "12+3" -> "3"   "12+" -> "12"   "5×-3" -> "-3"   "-5" -> "-5"
function getDisplayOperand(expression) {
    const base = stripTrailingOperators(expression);
    if (base === '') {
        if (expression === '-') return '-';
        if (expression === '+') return '+';
        return '0';
    }

    const match = /(\d*\.?\d*%*)$/.exec(base);
    let token = match[1];
    const start = base.length - token.length;

    const isNegative = base[start - 1] === '-' &&
        (start - 1 === 0 || isOperator(base[start - 2]));
    const isPositive = base[start - 1] === '+' &&
        (start - 1 === 0 || isOperator(base[start - 2]));

    if (isNegative) {
        token = '-' + token;
    }
    if (isPositive) {
        token = '+' + token;
    }
    return token === '' ? '0' : token;
}

function getErrorText(error) {
    switch (error.message) {
        case 'DIVIDE_BY_ZERO': return 'Cannot divide by zero';
        case 'OVERFLOW':       return 'Number too large';
        default:               return 'Invalid expression';
    }
}


/* =====================================================================
   4. CALCULATOR ACTIONS
   ===================================================================== */
function clearErrorIfNeeded() {
    if (state.errorMessage) {
        state.errorMessage = '';
        state.expression = '';
        state.previous = '';
        state.justEvaluated = false;
        state.lastOperation = null;
    }
}

// After "=", typing a digit starts a brand-new calculation
function startNewIfEvaluated() {
    if (state.justEvaluated) {
        state.expression = '';
        state.previous = '';
        state.justEvaluated = false;
        state.lastOperation = null;
    }
}

function inputDigit(digit) {
    clearErrorIfNeeded();
    startNewIfEvaluated();

    const expression = state.expression;

    if (expression.endsWith('%')) return;
    if (expression.length >= MAX_EXPRESSION_LENGTH) return;

    const lastNumber = getLastNumber(expression);
    if (lastNumber.length >= MAX_NUMBER_LENGTH) return;

    // Replace a lone leading zero ("0" + "5" -> "5")
    if (lastNumber === '0') {
        state.expression = expression.slice(0, -1) + digit;
    } else {
        state.expression = expression + digit;
    }
}

function inputDecimal() {
    clearErrorIfNeeded();

    if (state.justEvaluated) {
        state.expression = '0.';
        state.previous = '';
        state.justEvaluated = false;
        state.lastOperation = null;
        return;
    }

    const expression = state.expression;

    if (expression.endsWith('%')) return;
    if (expression.length >= MAX_EXPRESSION_LENGTH) return;

    const lastNumber = getLastNumber(expression);
    if (lastNumber.includes('.')) return;   // only one decimal point per number

    state.expression = expression + (lastNumber === '' ? '0.' : '.');
}

function inputOperator(operator) {
    clearErrorIfNeeded();

    // Continue from the previous result
    if (state.justEvaluated) {
        state.justEvaluated = false;
        state.previous = '';
        state.lastOperation = null;
    }

    const expression = state.expression;

    // Allow a sign to be entered as the first character
    if (expression === '') {
        if (operator === '-' || operator === '+') state.expression = operator;
        return;
    }
    if (expression === '-') return;

    // Replace a trailing operator instead of stacking operators
    if (isOperator(expression.slice(-1))) {
        let base = expression.slice(0, -1);
        if (isOperator(base.slice(-1))) {
            base = base.slice(0, -1);
        }
        if (base === '') return;
        state.expression = base + operator;
        return;
    }

    if (expression.length >= MAX_EXPRESSION_LENGTH) return;
    state.expression = expression + operator;
}

function inputPercent() {
    clearErrorIfNeeded();

    const expression = state.expression;
    if (expression === '') return;

    const lastCharacter = expression.slice(-1);
    if (!/[\d%]/.test(lastCharacter)) return;
    if (expression.length >= MAX_EXPRESSION_LENGTH) return;

    state.justEvaluated = false;
    state.previous = '';
    state.lastOperation = null;
    state.expression = expression + '%';
}

// Flips the sign of the number currently being edited
function toggleSign() {
    clearErrorIfNeeded();

    const expression = state.expression;
    if (expression === '' || expression === '0') return;
    if (isOperator(expression.slice(-1))) return;

    const match = /(\d*\.?\d*%*)$/.exec(expression);
    const start = expression.length - match[1].length;
    const before = expression[start - 1];
    const beforeBefore = expression[start - 2];
    let next;

    if (start === 0) {
        next = '-' + expression;
    } else if (before === '-') {
        const isUnary = (start - 1 === 0) || isOperator(beforeBefore);
        next = isUnary
            ? expression.slice(0, start - 1) + expression.slice(start)          // "5×-3" -> "5×3"
            : expression.slice(0, start - 1) + '+' + expression.slice(start);    // "5-3"  -> "5+3"
    } else if (before === '+') {
        next = expression.slice(0, start - 1) + '-' + expression.slice(start);    // "5+3"  -> "5-3"
    } else {
        next = expression.slice(0, start) + '-' + expression.slice(start);        // "5×3"  -> "5×-3"
    }

    state.justEvaluated = false;
    state.previous = '';
    state.lastOperation = null;
    state.expression = next;
}

function deleteLast() {
    if (state.errorMessage) {
        clearAll();
        return;
    }
    // Backspace does nothing on a finished result (like a normal calculator)
    if (state.justEvaluated) return;

    state.previous = '';
    state.expression = state.expression.slice(0, -1);
}

function clearAll() {
    state.expression = '';
    state.previous = '';
    state.errorMessage = '';
    state.justEvaluated = false;
    state.lastOperation = null;
}

// Remembers "operator + operand" of the last calculation for repeated "="
function rememberLastOperation(expression) {
    const match = /[\d%.]([+\-×÷])(-?[\d.]+%*)$/.exec(expression);
    state.lastOperation = match ? { operator: match[1], operand: match[2] } : null;
}

// Returns true when a result was produced successfully
function calculate() {
    if (state.errorMessage) return false;

    let expression;

    if (state.justEvaluated) {
        // Repeat the last operation: 5 + 3 = 8, = 11, = 14 ...
        if (!state.lastOperation) return false;
        expression = state.expression + state.lastOperation.operator + state.lastOperation.operand;
    } else {
        expression = state.expression;
        if (expression === '' || expression === '-') return false;

        // "5 +" then "=" means "5 + 5"
        if (isOperator(expression.slice(-1))) {
            const operator = expression.slice(-1);
            const base = stripTrailingOperators(expression);
            if (base === '') return false;
            expression = base + operator + getDisplayOperand(base);
        }
    }

    try {
        const result = formatNumber(evaluate(expression));
        if (!state.justEvaluated) {
            rememberLastOperation(expression);
        }
        state.previous = formatExpression(expression) + ' =';
        state.expression = result;
        state.justEvaluated = true;
        return true;
    } catch (error) {
        state.previous = formatExpression(expression) + ' =';
        state.expression = '';
        state.errorMessage = getErrorText(error);
        state.justEvaluated = false;
        state.lastOperation = null;
        return false;
    }
}


/* =====================================================================
   5. RENDERING
   Big line   = the number you are typing (or the result)
   Small line = the full expression
   ===================================================================== */
let lastRenderedText = null;

function fitDisplayText() {
    currentLineEl.style.fontSize = '';
    let size = parseFloat(getComputedStyle(currentLineEl).fontSize);

    while (currentLineEl.scrollWidth > currentLineEl.clientWidth && size > 18) {
        size -= 2;
        currentLineEl.style.fontSize = size + 'px';
    }
    currentLineEl.scrollLeft = currentLineEl.scrollWidth;
}

function render() {
    let text;
    let previousText;

    if (state.errorMessage) {
        text = state.errorMessage;
        previousText = state.previous;
    } else if (state.justEvaluated) {
        text = state.expression;               // the result
        previousText = state.previous;
    } else {
        text = getDisplayOperand(state.expression);
        previousText = formatExpression(state.expression);
    }

    currentLineEl.textContent = text;
    currentLineEl.classList.toggle('is-error', Boolean(state.errorMessage));
    if (previousLineEl.textContent !== previousText) {
        previousLineEl.textContent = previousText;
        slideInPreviousLine();
    }
    currentLineEl.classList.toggle('is-result', state.justEvaluated && !state.errorMessage);

    fitDisplayText();

    // Re-trigger the "new value" animation when the text changed
    if (text !== lastRenderedText) {
        currentLineEl.classList.remove('tick');
        void currentLineEl.offsetWidth;   // force reflow so the animation restarts
        currentLineEl.classList.add('tick');
        lastRenderedText = text;
    }
}


/* =====================================================================
   6. BUTTON FEEDBACK
   ===================================================================== */
function addRipple(button, event) {
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement('span');

    const clientX = event && event.clientX ? event.clientX : rect.left + rect.width / 2;
    const clientY = event && event.clientY ? event.clientY : rect.top + rect.height / 2;

    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (clientY - rect.top - size / 2) + 'px';

    button.appendChild(ripple);
    ripple.addEventListener('animationend', function () { ripple.remove(); });
}

function triggerEqualsGlow(button) {
    const targets = [button, displayEl, calculatorEl];

    targets.forEach(function (element) {
        element.classList.remove('is-glowing');
        void element.offsetWidth;
        element.classList.add('is-glowing');
    });

    setTimeout(function () {
        targets.forEach(function (element) { element.classList.remove('is-glowing'); });
    }, 950);

    const rect = button.getBoundingClientRect();
    Particles.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 46);
}

function flashKeyboardPress(button) {
    button.classList.add('is-pressed');
    setTimeout(function () { button.classList.remove('is-pressed'); }, 130);
}


/* =====================================================================
   7. EVENT HANDLING
   ===================================================================== */

// Runs the action tied to a button (used by mouse, touch and keyboard)
function activate(button, event) {
    const action = button.dataset.action;
    const value = button.dataset.value;

    switch (action) {
        case 'digit':     inputDigit(value);      break;
        case 'decimal':   inputDecimal();         break;
        case 'operator':  inputOperator(value);   break;
        case 'percent':   inputPercent();         break;
        case 'toggle':    toggleSign();           break;
        case 'backspace': deleteLast();           break;
        case 'clear':     clearAll();             break;
        case 'equals':    calculate();            break;
    }

    render();
    addRipple(button, event);
    playKeyAnimation(button, action);

    HertaGallery.next();

    if (action === 'equals') {
        triggerEqualsGlow(button);
    } else {
        const rect = button.getBoundingClientRect();
        Particles.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 5);
    }
}

// Mouse / touch clicks (one delegated listener)
keysContainer.addEventListener('click', function (event) {
    const button = event.target.closest('.key');
    if (button) {
        activate(button, event);
    }
});

// Keyboard: build a map of key name -> button from the data-keys attribute
const keyMap = new Map();
keyButtons.forEach(function (button) {
    (button.dataset.keys || '').split('|').forEach(function (keyName) {
        if (keyName) keyMap.set(keyName, button);
    });
});

document.addEventListener('keydown', function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const button = keyMap.get(event.key);
    if (!button) return;

    event.preventDefault();   // stops "/" quick-find and Enter re-clicking a focused button
    if (event.repeat && button.dataset.action !== 'backspace') return;

    flashKeyboardPress(button);
    activate(button, null);
});


/* =====================================================================
   8. PARTICLE SYSTEM
   Twinkling stars, drifting magical motes, and sparkle bursts.
   ===================================================================== */
const Particles = (function () {
    const canvas = document.getElementById('particles');
    const context = canvas.getContext('2d');

    const STAR_COLORS = ['235,225,255', '200,180,255', '170,190,255', '240,190,255'];
    const stars = [];
    const motes = [];
    const sparks = [];

    let width = 0;
    let height = 0;

    function random(min, max) {
        return min + Math.random() * (max - min);
    }

    function pick(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    function buildField() {
        stars.length = 0;
        motes.length = 0;

        const area = width * height;
        const starCount = Math.min(170, Math.round(area / 9000));
        const moteCount = Math.min(45, Math.round(area / 28000));

        for (let i = 0; i < starCount; i++) {
            stars.push({
                x: Math.random() * width,
                y: Math.random() * height,
                radius: random(0.4, 1.7),
                phase: Math.random() * Math.PI * 2,
                speed: random(0.5, 1.6),
                color: pick(STAR_COLORS)
            });
        }

        for (let i = 0; i < moteCount; i++) {
            motes.push({
                x: Math.random() * width,
                y: Math.random() * height,
                radius: random(1, 3.2),
                vx: random(-0.12, 0.12),
                vy: random(-0.45, -0.12),
                alpha: random(0.2, 0.6),
                phase: Math.random() * Math.PI * 2,
                color: pick(STAR_COLORS)
            });
        }
    }

    function resize() {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        buildField();
    }

    // Four-pointed sparkle star
    function drawSparkle(x, y, size, color, alpha) {
        context.fillStyle = 'rgba(' + color + ',' + alpha + ')';
        context.beginPath();
        context.moveTo(x, y - size);
        context.quadraticCurveTo(x, y, x + size, y);
        context.quadraticCurveTo(x, y, x, y + size);
        context.quadraticCurveTo(x, y, x - size, y);
        context.quadraticCurveTo(x, y, x, y - size);
        context.fill();
    }

    function drawDot(x, y, radius, color, alpha) {
        context.fillStyle = 'rgba(' + color + ',' + alpha + ')';
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
    }

    function drawFrame(time) {
        const seconds = time / 1000;
        context.clearRect(0, 0, width, height);
        context.globalCompositeOperation = 'lighter';

        // Stars
        stars.forEach(function (star) {
            const twinkle = 0.5 + 0.5 * Math.sin(seconds * star.speed + star.phase);
            const alpha = 0.2 + 0.8 * twinkle;

            if (star.radius > 1.15) {
                drawSparkle(star.x, star.y, star.radius * 3.2 * (0.6 + twinkle * 0.4), star.color, alpha);
            } else {
                drawDot(star.x, star.y, star.radius, star.color, alpha);
            }
        });

        // Floating motes
        motes.forEach(function (mote) {
            if (!prefersReducedMotion) {
                mote.x += mote.vx + Math.sin(seconds + mote.phase) * 0.12;
                mote.y += mote.vy;

                if (mote.y < -10) { mote.y = height + 10; mote.x = Math.random() * width; }
                if (mote.x < -10) mote.x = width + 10;
                if (mote.x > width + 10) mote.x = -10;
            }
            const pulse = 0.6 + 0.4 * Math.sin(seconds * 1.4 + mote.phase);
            drawDot(mote.x, mote.y, mote.radius * 2.6, mote.color, mote.alpha * 0.12 * pulse);
            drawDot(mote.x, mote.y, mote.radius, mote.color, mote.alpha * pulse);
        });

        // Burst sparks
        for (let i = sparks.length - 1; i >= 0; i--) {
            const spark = sparks[i];
            spark.x += spark.vx;
            spark.y += spark.vy;
            spark.vx *= 0.97;
            spark.vy = spark.vy * 0.97 + 0.03;   // slight gravity
            spark.life -= 0.018;

            if (spark.life <= 0) {
                sparks.splice(i, 1);
                continue;
            }
            drawSparkle(spark.x, spark.y, spark.size * spark.life, spark.color, spark.life);
        }

        context.globalCompositeOperation = 'source-over';
    }

    function loop(time) {
        drawFrame(time);
        requestAnimationFrame(loop);
    }

    function burst(x, y, count) {
        if (prefersReducedMotion) return;

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = random(0.8, count > 10 ? 5.5 : 2.5);
            sparks.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 0.5,
                size: random(2.5, count > 10 ? 7 : 4.5),
                life: random(0.7, 1),
                color: pick(STAR_COLORS)
            });
        }
        if (sparks.length > 220) {
            sparks.splice(0, sparks.length - 220);
        }
    }

    function start() {
        resize();
        window.addEventListener('resize', resize);

        if (prefersReducedMotion) {
            drawFrame(0);       // one static frame of stars
        } else {
            requestAnimationFrame(loop);
        }
    }

    return { start: start, burst: burst };
})();


/* =====================================================================
   9. HERTA GALLERY
   - Picks a random image (1.jpg ... 15.jpg) on every number click
   - Never shows the same image twice in a row (when 2+ images exist)
   - Fades the old image out, preloads the new one, then fades it in
   - Skips images that fail to load (missing / broken files)
   - Card effects: glow pulse, aura surge, flash ring, sparkles
   ===================================================================== */
const HertaGallery = (function () {
    const TOTAL_IMAGES = 15;
    const EXTENSION = '.jpg';
    const IMAGE_DIRECTORY = 'Images/';
    const LEAVE_MS = 260;              // must match the CSS fade-out time (.26s)

    // DOM references
    const portrait   = document.getElementById('portrait');
    const frame      = document.getElementById('portraitFrame');
    const image      = document.getElementById('hertaImage');
    const backdrop   = document.getElementById('portraitBackdrop');
    const fallback   = document.getElementById('portraitFallback');
    const flash      = document.getElementById('portraitFlash');

    // State
    const loadCache = new Map();       // number -> Promise<boolean>
    const keepAlive = [];              // keeps preloaded Image objects in memory
    const failed = new Set();          // numbers whose file could not be loaded
    let lastPicked = null;             // last picked number (prevents repeats)
    let transitionToken = 0;           // lets rapid clicks cancel stale transitions
    let galleryImageShown = false;     // true once a numbered image is on screen
    let activeBursts = 0;              // live burst sparkles (capped for performance)

    const SPARKLE_CHARS  = ['✦', '✧', '✶', '✺'];
    const SPARKLE_COLORS = ['#d8c8ff', '#f0a6ff', '#a78bfa', '#6f8cff', '#ffffff'];

    function random(min, max) {
        return min + Math.random() * (max - min);
    }

    function pick(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    function wait(milliseconds) {
        return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
    }

    /* ---------- Image loading ---------- */

    // Loads (and caches) one image. Resolves true on success, false on error.
    function loadImage(number) {
        if (loadCache.has(number)) {
            return loadCache.get(number);
        }

        const promise = new Promise(function (resolve) {
            const preload = new Image();
            preload.decoding = 'async';
            preload.onload = function () { resolve(true); };
            preload.onerror = function () { failed.add(number); resolve(false); };
            preload.src = IMAGE_DIRECTORY + number + EXTENSION;
            keepAlive.push(preload);
        });

        loadCache.set(number, promise);
        return promise;
    }

    // Quietly preloads all images one by one after the page has loaded
    function preloadAll() {
        let number = 1;
        (function step() {
            if (number > TOTAL_IMAGES) return;
            loadImage(number++).then(function () { setTimeout(step, 60); });
        })();
    }

    // Random pick that avoids the previous image and known-broken files
    function pickNext() {
        const available = [];
        for (let n = 1; n <= TOTAL_IMAGES; n++) {
            if (!failed.has(n)) available.push(n);
        }
        if (available.length === 0) return null;

        const candidates = available.filter(function (n) { return n !== lastPicked; });
        return pick(candidates.length > 0 ? candidates : available);
    }

    /* ---------- Card effects ---------- */

    function restartClass(element, className, duration) {
        element.classList.remove(className);
        void element.offsetWidth;          // restart the CSS animation
        element.classList.add(className);
        setTimeout(function () { element.classList.remove(className); }, duration);
    }

    // Card glow + aura surge
    function pulseCard() {
        restartClass(frame, 'is-pulsing', 950);
        restartClass(portrait, 'is-surge', 950);
    }

    // Ambient sparkles that float around the card all the time
    function buildSparkles() {
        if (prefersReducedMotion) return;

        const COUNT = 14;
        for (let i = 0; i < COUNT; i++) {
            const angle = (i / COUNT) * Math.PI * 2 + random(-0.2, 0.2);
            const x = 50 + Math.cos(angle) * random(50, 58);   // % (ring around the card)
            const y = 50 + Math.sin(angle) * random(49, 57);

            const sparkle = document.createElement('span');
            sparkle.className = 'sparkle' + (i >= 8 ? ' sparkle-extra' : '');
            sparkle.setAttribute('aria-hidden', 'true');
            sparkle.textContent = pick(SPARKLE_CHARS);
            sparkle.style.setProperty('--x', x.toFixed(1) + '%');
            sparkle.style.setProperty('--y', y.toFixed(1) + '%');
            sparkle.style.setProperty('--size', random(0.7, 1.5).toFixed(2) + 'rem');
            sparkle.style.setProperty('--c', pick(SPARKLE_COLORS));
            sparkle.style.setProperty('--dx', (Math.cos(angle) * random(8, 24)).toFixed(1) + 'px');
            sparkle.style.setProperty('--dy', (Math.sin(angle) * random(8, 24) - 12).toFixed(1) + 'px');
            sparkle.style.setProperty('--dur', random(3.2, 6).toFixed(2) + 's');
            sparkle.style.setProperty('--delay', (-random(0, 6)).toFixed(2) + 's');
            portrait.appendChild(sparkle);
        }
    }

    // Short burst of sparkles flying outward from the card on every number click
    function sparkleBurst() {
        if (prefersReducedMotion || activeBursts > 40) return;

        for (let i = 0; i < 10; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = random(60, 130);

            const sparkle = document.createElement('span');
            sparkle.className = 'sparkle-burst';
            sparkle.setAttribute('aria-hidden', 'true');
            sparkle.textContent = pick(SPARKLE_CHARS);
            sparkle.style.setProperty('--x', random(25, 75).toFixed(1) + '%');
            sparkle.style.setProperty('--y', random(25, 75).toFixed(1) + '%');
            sparkle.style.setProperty('--size', random(0.8, 1.6).toFixed(2) + 'rem');
            sparkle.style.setProperty('--c', pick(SPARKLE_COLORS));
            sparkle.style.setProperty('--tx', (Math.cos(angle) * distance).toFixed(1) + 'px');
            sparkle.style.setProperty('--ty', (Math.sin(angle) * distance).toFixed(1) + 'px');

            activeBursts++;
            sparkle.addEventListener('animationend', function () {
                sparkle.remove();
                activeBursts--;
            });
            portrait.appendChild(sparkle);
        }
    }

    /* ---------- Showing an image ---------- */

    function applyImage(number, myToken) {
        const source = IMAGE_DIRECTORY + number + EXTENSION;

        image.src = source;
        image.alt = 'The Herta — portrait ' + number;
        image.hidden = false;
        fallback.hidden = true;
        backdrop.style.backgroundImage = 'url("' + source + '")';
        galleryImageShown = true;

        // Wait until the browser has decoded it, then play the entrance animation
        const decoded = (image.decode ? image.decode() : Promise.resolve()).catch(function () {});

        decoded.then(function () {
            if (myToken !== transitionToken) return;    // a newer click took over

            image.classList.remove('is-leaving');
            image.classList.remove('is-entering');
            void image.offsetWidth;
            image.classList.add('is-entering');

            restartClass(flash, 'is-active', 900);

            image.addEventListener('animationend', function onEnd(event) {
                if (event.animationName !== 'imageIn') return;
                image.classList.remove('is-entering');
                image.removeEventListener('animationend', onEnd);
            });
        });
    }

    /* ---------- Public: change the image ---------- */

    async function next() {
        const myToken = ++transitionToken;

        // 1. Instant feedback: card glow, sparkles, and start fading the old image
        pulseCard();
        sparkleBurst();
        image.classList.remove('is-entering');
        image.classList.add('is-leaving');

        const leaveTimer = wait(prefersReducedMotion ? 0 : LEAVE_MS);

        // 2. Pick and preload a random image (retry if a file turns out to be broken)
        let chosen = null;
        for (let attempt = 0; attempt < 4 && chosen === null; attempt++) {
            const candidate = pickNext();
            if (candidate === null) break;

            lastPicked = candidate;
            const ok = await loadImage(candidate);
            if (myToken !== transitionToken) return;    // superseded by a newer click
            if (ok) chosen = candidate;
        }

        // 3. Let the fade-out finish before swapping
        await leaveTimer;
        if (myToken !== transitionToken) return;

        // Nothing could be loaded: bring the old image back
        if (chosen === null) {
            image.classList.remove('is-leaving');
            return;
        }

        applyImage(chosen, myToken);
    }

    /* ---------- Fallback + setup ---------- */

    function showFallback() {
        image.hidden = true;
        fallback.hidden = false;
    }

    function init() {
        // Backdrop for the starting image
        backdrop.style.backgroundImage = 'url("' + IMAGE_DIRECTORY + '1' + EXTENSION + '")';
        lastPicked = 1;

        // If the initial portrait is missing, show the emblem until an image appears.
        image.addEventListener('error', function () {
            if (!galleryImageShown) showFallback();
        });
        if (image.complete && image.naturalWidth === 0 && !galleryImageShown) {
            showFallback();
        }

        buildSparkles();

        // Preload everything a moment after the page has finished loading
        window.addEventListener('load', function () { setTimeout(preloadAll, 600); });
    }

    return { init: init, next: next };
})();


/* =====================================================================
   10. INITIALISATION
   ===================================================================== */
keyButtons.forEach(function (button, index) {
    button.style.setProperty('--i', index);   // staggered entrance animation
});

Particles.start();
HertaGallery.init();
render();


/* =====================================================================
   11. KEY ANIMATIONS
   Uses the Web Animations API so it never clashes with the CSS animations.
   Number keys pop, AC shakes + shatters, ⌫ slides, operators spin, = pulses.
   ===================================================================== */
function playKeyAnimation(button, action) {
    if (prefersReducedMotion || !button.animate) return;

    const rect = button.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    switch (action) {
        case 'digit':
        case 'decimal':
            button.animate([
                { transform: 'scale(0.88)' },
                { transform: 'scale(1.1)', boxShadow: '0 0 30px rgba(200,160,255,0.95)' },
                { transform: 'scale(1)' }
            ], { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
            break;

        case 'operator':
            button.animate([
                { transform: 'rotate(0deg) scale(0.9)' },
                { transform: 'rotate(180deg) scale(1.12)', filter: 'brightness(1.5)' },
                { transform: 'rotate(360deg) scale(1)' }
            ], { duration: 420, easing: 'ease-out' });
            break;

        case 'clear':
            // Shake + pink flash, then a shatter of sparks
            button.animate([
                { transform: 'rotate(0deg) scale(1)' },
                { transform: 'rotate(-14deg) scale(0.9)', filter: 'hue-rotate(40deg) brightness(1.5)' },
                { transform: 'rotate(12deg) scale(1.08)' },
                { transform: 'rotate(-8deg)' },
                { transform: 'rotate(4deg)' },
                { transform: 'rotate(0deg) scale(1)' }
            ], { duration: 460, easing: 'ease-in-out' });
            Particles.burst(centerX, centerY, 18);
            calculatorEl.animate([
                { transform: 'translateX(0)' }, { transform: 'translateX(-5px)' },
                { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }
            ], { duration: 260 });
            break;

        case 'backspace':
            button.animate([
                { transform: 'translateX(0) scale(1)' },
                { transform: 'translateX(-9px) scale(0.9)', filter: 'brightness(1.6)' },
                { transform: 'translateX(3px) scale(1.04)' },
                { transform: 'translateX(0) scale(1)' }
            ], { duration: 320, easing: 'ease-out' });
            break;

        case 'toggle':
        case 'percent':
            button.animate([
                { transform: 'rotateX(0deg) scale(0.92)' },
                { transform: 'rotateX(180deg) scale(1.08)' },
                { transform: 'rotateX(360deg) scale(1)' }
            ], { duration: 400, easing: 'ease-out' });
            break;

        case 'equals':
            button.animate([
                { transform: 'scale(0.9)' },
                { transform: 'scale(1.18) rotate(-4deg)' },
                { transform: 'scale(1) rotate(0deg)' }
            ], { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
            calculatorEl.animate([
                { transform: 'scale(1)' }, { transform: 'scale(1.015)' }, { transform: 'scale(1)' }
            ], { duration: 520, easing: 'ease-out' });
            break;
    }
}

// The small expression line slides up whenever its text changes
function slideInPreviousLine() {
    if (prefersReducedMotion || !previousLineEl.animate) return;
    previousLineEl.animate([
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 220, easing: 'ease-out' });
}


/* =====================================================================
   12. INTERACTIVE BACKGROUND
   Moves the glowing orbs a little with the mouse (CSS reads --mx / --my).
   ===================================================================== */
(function setupInteractiveBackground() {
    if (prefersReducedMotion) return;

    let frameRequested = false;
    let mouseX = 0;
    let mouseY = 0;

    document.addEventListener('pointermove', function (event) {
        if (event.pointerType === 'touch') return;
        mouseX = event.clientX / window.innerWidth - 0.5;
        mouseY = event.clientY / window.innerHeight - 0.5;

        if (!frameRequested) {
            frameRequested = true;
            requestAnimationFrame(function () {
                frameRequested = false;
                document.documentElement.style.setProperty('--mx', (mouseX * 2).toFixed(3));
                document.documentElement.style.setProperty('--my', (mouseY * 2).toFixed(3));
            });
        }
    }, { passive: true });
})();


/* =====================================================================
   13. CARD EFFECTS
   3D tilt, image zoom + parallax, holographic shine, glowing border
   and floating motes for the portrait card.
   ===================================================================== */
const CardEffects = (function () {
    const MAX_TILT_X = 12;       // degrees
    const MAX_TILT_Y = 16;       // degrees
    const MAX_MOTES = 26;
    const MOTE_COLORS = ['#d8c8ff', '#f0a6ff', '#a78bfa', '#6f8cff', '#ffffff'];

    const portrait = document.getElementById('portrait');
    const frame = document.getElementById('portraitFrame');

    let pendingEvent = null;
    let frameRequested = false;
    let liveMotes = 0;
    let lastMoteTime = 0;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function applyTilt() {
        frameRequested = false;
        if (!pendingEvent) return;

        const rect = frame.getBoundingClientRect();
        const x = clamp((pendingEvent.clientX - rect.left) / rect.width, 0, 1);
        const y = clamp((pendingEvent.clientY - rect.top) / rect.height, 0, 1);

        frame.style.setProperty('--ry', ((x - 0.5) * 2 * MAX_TILT_Y).toFixed(2) + 'deg');
        frame.style.setProperty('--rx', ((0.5 - y) * 2 * MAX_TILT_X).toFixed(2) + 'deg');
        frame.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
        frame.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
        frame.style.setProperty('--px', ((0.5 - x) * 22).toFixed(1) + 'px');
        frame.style.setProperty('--py', ((0.5 - y) * 22).toFixed(1) + 'px');

        spawnMote(rect);
    }

    // A tiny glowing particle drifting up around the card
    function spawnMote(frameRect) {
        const now = performance.now();
        if (now - lastMoteTime < 130 || liveMotes >= MAX_MOTES) return;
        lastMoteTime = now;

        const portraitRect = portrait.getBoundingClientRect();
        const side = Math.random();
        let x;
        let y;
        if (side < 0.5) {          // along the left / right edges
            x = (Math.random() < 0.5 ? -4 : 104);
            y = Math.random() * 100;
        } else {                   // along the top / bottom edges
            x = Math.random() * 100;
            y = (Math.random() < 0.5 ? -3 : 103);
        }

        const mote = document.createElement('span');
        mote.className = 'card-mote';
        mote.setAttribute('aria-hidden', 'true');
        mote.style.setProperty('--x', ((x / 100) * frameRect.width + (frameRect.left - portraitRect.left)).toFixed(1) + 'px');
        mote.style.setProperty('--y', ((y / 100) * frameRect.height + (frameRect.top - portraitRect.top)).toFixed(1) + 'px');
        mote.style.setProperty('--s', (3 + Math.random() * 5).toFixed(1) + 'px');
        mote.style.setProperty('--dx', ((Math.random() - 0.5) * 50).toFixed(1) + 'px');
        mote.style.setProperty('--c', MOTE_COLORS[Math.floor(Math.random() * MOTE_COLORS.length)]);

        liveMotes++;
        mote.addEventListener('animationend', function () {
            mote.remove();
            liveMotes--;
        });
        portrait.appendChild(mote);
    }

    function onEnter(event) {
        if (event.pointerType === 'touch') return;
        frame.classList.add('is-tilting');
    }

    function onMove(event) {
        if (event.pointerType === 'touch') return;
        pendingEvent = event;
        if (!frameRequested) {
            frameRequested = true;
            requestAnimationFrame(applyTilt);
        }
    }

    function onLeave() {
        pendingEvent = null;
        frame.classList.remove('is-tilting');
        ['--rx', '--ry', '--gx', '--gy', '--px', '--py'].forEach(function (name) {
            frame.style.removeProperty(name);
        });
    }

    function init() {
        if (prefersReducedMotion) return;
        portrait.addEventListener('pointerenter', onEnter);
        portrait.addEventListener('pointermove', onMove, { passive: true });
        portrait.addEventListener('pointerleave', onLeave);
    }

    return { init: init };
})();


/* =====================================================================
   14. CURSOR TRAIL
   A soft purple glow trail made of tiny sparkles. It lives on its own
   click-through canvas and the loop only runs while particles exist.
   ===================================================================== */
const CursorTrail = (function () {
    const canvas = document.getElementById('cursorTrail');
    const context = canvas.getContext('2d');
    const COLORS = ['216,200,255', '167,139,250', '240,166,255', '111,140,255'];
    const MAX_PARTICLES = 90;

    const particles = [];
    let width = 0;
    let height = 0;
    let running = false;
    let lastX = -1;
    let lastY = -1;

    function resize() {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function addParticle(x, y) {
        if (particles.length >= MAX_PARTICLES) particles.shift();
        particles.push({
            x: x + (Math.random() - 0.5) * 8,
            y: y + (Math.random() - 0.5) * 8,
            vx: (Math.random() - 0.5) * 0.7,
            vy: Math.random() * -0.6 - 0.1,
            size: 1.5 + Math.random() * 3.5,
            life: 1,
            color: COLORS[Math.floor(Math.random() * COLORS.length)]
        });
    }

    function onMove(event) {
        if (event.pointerType !== 'mouse') return;

        // More particles when the mouse moves further
        const distance = lastX < 0 ? 0 : Math.hypot(event.clientX - lastX, event.clientY - lastY);
        lastX = event.clientX;
        lastY = event.clientY;
        const count = Math.min(3, 1 + Math.floor(distance / 25));
        for (let i = 0; i < count; i++) addParticle(event.clientX, event.clientY);

        if (!running) {
            running = true;
            requestAnimationFrame(draw);
        }
    }

    function draw() {
        context.clearRect(0, 0, width, height);
        context.globalCompositeOperation = 'lighter';

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.028;

            if (p.life <= 0) {
                particles.splice(i, 1);
                continue;
            }
            const radius = p.size * p.life;
            const glow = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 3);
            glow.addColorStop(0, 'rgba(' + p.color + ',' + (p.life * 0.9) + ')');
            glow.addColorStop(1, 'rgba(' + p.color + ',0)');
            context.fillStyle = glow;
            context.beginPath();
            context.arc(p.x, p.y, radius * 3, 0, Math.PI * 2);
            context.fill();
        }
        context.globalCompositeOperation = 'source-over';

        if (particles.length > 0) {
            requestAnimationFrame(draw);
        } else {
            running = false;                 // stop the loop when nothing is left
            context.clearRect(0, 0, width, height);
        }
    }

    function init() {
        if (prefersReducedMotion) return;
        resize();
        window.addEventListener('resize', resize);
        window.addEventListener('pointermove', onMove, { passive: true });
        document.addEventListener('pointerleave', function () { lastX = -1; });
    }

    return { init: init };
})();


/* =====================================================================
   15. HERTA SPECIAL ABILITY
   Click the "Herta's Special" button (or press H) to play a ~4.4 second
   Honkai: Star Rail style ability. Timing matches the CSS (section 15).
   ===================================================================== */
const HertaSpecial = (function () {
    const DURATION = 4400;          // must match the 4.4s CSS animations

    const MESSAGES = [
        { title: "HERTA'S CURIOUS COLLECTION!",     sub: '✦ Kuru kuru~ ✦' },
        { title: 'THE GENIUS SOCIETY HAS ARRIVED!', sub: '✦ Genius Society · #83 ✦' },
        { title: 'THE HERTA IS HERE!',              sub: '✦ Simulated Universe unlocked ✦' }
    ];
    const STAR_CHARS = ['✦', '✧', '✶', '✺', '❀'];
    const STAR_COLORS = ['#ffffff', '#d8c8ff', '#f0a6ff', '#a78bfa', '#9db4ff'];

    const button = document.getElementById('hertaSpecial');
    const overlay = document.getElementById('hertaOverlay');
    const hologram = document.getElementById('hoHologram');
    const starsLayer = document.getElementById('hoStars');
    const titleEl = document.getElementById('hoTitle');
    const subEl = document.getElementById('hoSub');
    const portraitImage = document.getElementById('hertaImage');

    let isActive = false;
    let messageIndex = 0;
    const timers = [];

    function later(callback, delay) {
        timers.push(setTimeout(callback, delay));
    }

    function buildStars() {
        starsLayer.textContent = '';
        for (let i = 0; i < 44; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = 90 + Math.random() * 260;
            const star = document.createElement('span');
            star.className = 'ho-star';
            star.textContent = STAR_CHARS[Math.floor(Math.random() * STAR_CHARS.length)];
            star.style.setProperty('--x', (35 + Math.random() * 30).toFixed(1) + '%');
            star.style.setProperty('--y', (35 + Math.random() * 30).toFixed(1) + '%');
            star.style.setProperty('--size', (0.8 + Math.random() * 1.8).toFixed(2) + 'rem');
            star.style.setProperty('--c', STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]);
            star.style.setProperty('--tx', (Math.cos(angle) * distance).toFixed(0) + 'px');
            star.style.setProperty('--ty', (Math.sin(angle) * distance).toFixed(0) + 'px');
            star.style.setProperty('--dur', (1.6 + Math.random() * 1.8).toFixed(2) + 's');
            star.style.setProperty('--delay', (Math.random() * 2.2).toFixed(2) + 's');
            starsLayer.appendChild(star);
        }
    }

    function explode(x, y, count) {
        Particles.burst(x, y, count);
    }

    function finish() {
        overlay.classList.remove('is-active');
        document.body.classList.remove('herta-active');
        button.classList.remove('is-busy');
        starsLayer.textContent = '';
        isActive = false;
    }

    function activate() {
        if (isActive) return;
        isActive = true;

        const message = MESSAGES[messageIndex++ % MESSAGES.length];
        titleEl.textContent = message.title;
        subEl.textContent = message.sub;

        // Reduced motion: just show the message for a moment (no flashing effects)
        if (prefersReducedMotion) {
            overlay.classList.add('is-active');
            later(function () { overlay.classList.remove('is-active'); isActive = false; }, 2200);
            return;
        }

        // Holographic copy of whichever portrait is on screen right now
        hologram.style.backgroundImage = 'url("' + (portraitImage.currentSrc || portraitImage.src) + '")';
        buildStars();

        button.classList.add('is-busy');
        document.body.classList.add('herta-active');
        overlay.classList.remove('is-active');
        void overlay.offsetWidth;                 // restart all CSS animations
        overlay.classList.add('is-active');

        // Particle explosions timed with the animation
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const rect = button.getBoundingClientRect();
        explode(rect.left + rect.width / 2, rect.top + rect.height / 2, 60);
        later(function () { explode(centerX, centerY, 90); }, 250);
        later(function () { explode(centerX * 0.5, centerY, 50); explode(centerX * 1.5, centerY, 50); }, 700);
        later(function () { explode(centerX, centerY * 0.6, 70); }, 1400);
        later(function () { explode(centerX, centerY, 100); }, 3500);

        // The portrait card changes during the ability
        later(function () { HertaGallery.next(); }, 900);
        later(function () { HertaGallery.next(); }, 2600);

        later(finish, DURATION);
    }

    function init() {
        button.addEventListener('click', activate);

        document.addEventListener('keydown', function (event) {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === 'h' || event.key === 'H') {
                event.preventDefault();
                activate();
            }
        });
    }

    return { init: init };
})();

CardEffects.init();
CursorTrail.init();
HertaSpecial.init();