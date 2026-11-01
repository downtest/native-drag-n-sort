// Тестовый DOM-хелпер: jsdom + реалистичный hit-testing.
// jsdom не реализует layout, поэтому elementsFromPoint подменяется:
// координаты элементов задаются вручную через layout(), а hit-test
// возвращает цепочку предков элемента под точкой.
import { JSDOM } from 'jsdom';

export const setupDom = (html) => {
    const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
        pretendToBeVisual: true,
        url: 'http://localhost/',
    });

    const { window } = dom;
    const { document } = window;

    // Модуль обращается к глобальным document/window/rAF — переключаем их на текущий DOM.
    // Тесты запускаются последовательно (--test-concurrency=1), поэтому это безопасно.
    globalThis.window = window;
    globalThis.document = document;
    globalThis.CustomEvent = window.CustomEvent;
    globalThis.MouseEvent = window.MouseEvent;
    globalThis.Element = window.Element;

    // Ручной layout: element -> { top, left, width, height }
    const layoutMap = new WeakMap();
    const layout = (el, box) => {
        const existing = layoutMap.get(el) || { top: 0, left: 0, width: 0, height: 0 };
        layoutMap.set(el, { ...existing, ...box });
        return el;
    };
    const rectOf = (el) => {
        const box = layoutMap.get(el) || { top: 0, left: 0, width: 0, height: 0 };
        return {
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            bottom: box.top + box.height,
            right: box.left + box.width,
            x: box.left,
            y: box.top,
            toJSON() { return this; },
        };
    };

    // Элемент под точкой: самый глубокий из зарегистрированных, содержащих точку.
    const hitTest = (x, y) => {
        const candidates = [];
        const walk = (node) => {
            for (const child of node.children) {
                const box = layoutMap.get(child);
                if (box && x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) {
                    candidates.push(child);
                }
                walk(child);
            }
        };
        walk(document.body);
        if (!candidates.length) return [document.body];

        // Самый глубокий элемент + его предки (как делает браузер)
        const deepest = candidates[candidates.length - 1];
        const chain = [];
        let node = deepest;
        while (node && node !== document.body) {
            chain.push(node);
            node = node.parentElement;
        }
        chain.push(document.body);
        return chain;
    };

    document.elementsFromPoint = (x, y) => hitTest(x, y);

    // getBoundingClientRect из ручного layout
    window.Element.prototype.getBoundingClientRect = function () {
        return rectOf(this);
    };

    // Детерминированный rAF: колбэки складываются в очередь и выполняются по flushFrames().
    const frames = [];
    const requestFrame = (fn) => {
        frames.push(fn);
        return frames.length;
    };
    const cancelFrame = (id) => {
        if (id > 0) frames[id - 1] = null;
    };
    window.requestAnimationFrame = requestFrame;
    window.cancelAnimationFrame = cancelFrame;
    globalThis.requestAnimationFrame = requestFrame;
    globalThis.cancelAnimationFrame = cancelFrame;

    const flushFrames = () => {
        const queued = frames.splice(0, frames.length);
        queued.forEach((fn) => fn && fn(0));
    };

    return { dom, window, document, layout, rectOf, flushFrames };
};

// Эмуляция мыши: mousedown на элементе, mousemove/mouseup на document.
export const createMouse = (window, document) => {
    const fire = (target, type, x, y) => {
        const event = new window.MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
        });
        target.dispatchEvent(event);
        return event;
    };

    return {
        down: (target, x, y) => fire(target, 'mousedown', x, y),
        move: (x, y) => fire(document, 'mousemove', x, y),
        up: (x, y) => fire(document, 'mouseup', x, y),
    };
};

// Эмуляция касаний: jsdom не реализует TouchEvent, поэтому touches
// добавляется к обычному Event — модуль читает только clientX/clientY.
export const createTouch = (window, document) => {
    const fire = (target, type, x, y) => {
        const event = new window.Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'touches', {
            value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }],
        });
        target.dispatchEvent(event);
        return event;
    };

    return {
        start: (target, x, y) => fire(target, 'touchstart', x, y),
        move: (x, y) => fire(document, 'touchmove', x, y),
        end: (x, y) => fire(document, 'touchend', x, y),
        cancel: (x, y) => fire(document, 'touchcancel', x, y),
    };
};

// Ожидание таймера dragDelay
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
