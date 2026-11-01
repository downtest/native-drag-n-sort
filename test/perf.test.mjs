// Тесты производительности: горячий путь drag не должен зависеть от глубины/размера дерева.
// Проверяем не «скорость» в миллисекундах (в jsdom она нерепрезентативна),
// а количество дорогих операций: глубокий клон поддерева и обход потомков.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, createMouse, wait } from './helpers.mjs';
import dragNDrop from '../index.js';

// Плоский список из N элементов, у каждого — вложенный (пустой) контейнер.
const setupWide = (count = 40) => {
    const items = Array.from({ length: count }, (_, i) =>
        `<div class="item" data-id="i${i}"><div class="container" data-id="c${i}"></div></div>`
    ).join('');
    const env = setupDom(`<div class="container" id="root" data-id="root">${items}</div>`);
    const { document, layout } = env;
    const root = document.querySelector('#root');

    layout(root, { top: 0, left: 0, width: 400, height: count * 40 });
    [...root.children].forEach((el, i) => {
        layout(el, { top: i * 40, left: 0, width: 400, height: 40 });
        layout(el.firstElementChild, { top: i * 40 + 20, left: 0, width: 400, height: 20 });
    });

    return { ...env, root };
};

test('глубокий клон создаётся фиксированное число раз за drag', async () => {
    const { root, document, flushFrames } = setupWide(40);
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    const itemNodes = new Set(root.children);
    let clones = 0;
    const originalCloneNode = document.defaultView.Element.prototype.cloneNode;
    document.defaultView.Element.prototype.cloneNode = function (...args) {
        // Считаем только клонирование самих перетаскиваемых элементов
        if (itemNodes.has(this)) clones++;
        return originalCloneNode.apply(this, args);
    };

    try {
        const first = root.children[0];
        mouse.down(first, 10, 10);
        await wait(10);
        // Ведём курсор через весь список: десятки смен цели за один drag
        for (let i = 1; i < 40; i++) {
            mouse.move(10, i * 40 + 5);
            flushFrames();
        }
        mouse.up(10, 39 * 40 + 5);
        flushFrames();
    } finally {
        document.defaultView.Element.prototype.cloneNode = originalCloneNode;
    }

    // 1 — кэшированный клон для drag, 2 — ghost под курсором, 3 — индикатор цели.
    // Дальше клон переиспользуется при любой смене цели.
    assert.ok(clones <= 3, `клонов за drag: ${clones}, ожидалось не больше 3`);
    assert.equal(manager.getState().isDragging, false);

    manager.destroy();
});

test('поиск вложенного контейнера выполняется не больше одного раза на элемент', async () => {
    const { root, document, flushFrames } = setupWide(40);
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    const itemNodes = new Set(root.children);
    const lookups = new Map();
    const originalQuerySelector = document.defaultView.Element.prototype.querySelector;
    document.defaultView.Element.prototype.querySelector = function (...args) {
        if (itemNodes.has(this)) lookups.set(this, (lookups.get(this) || 0) + 1);
        return originalQuerySelector.apply(this, args);
    };

    try {
        mouse.down(root.children[0], 10, 10);
        await wait(10);
        // Три прохода по списку: без кэша элемент опрашивался бы многократно
        for (let pass = 0; pass < 3; pass++) {
            for (let i = 1; i < 40; i++) {
                mouse.move(10, i * 40 + 5);
                flushFrames();
            }
        }
        mouse.up(10, 20);
        flushFrames();
    } finally {
        document.defaultView.Element.prototype.querySelector = originalQuerySelector;
    }

    const worst = Math.max(0, ...lookups.values());
    assert.ok(worst <= 1, `максимум обходов одного элемента: ${worst}, ожидалось 1`);

    manager.destroy();
});
