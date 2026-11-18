// Тесты масштаба: список на 1000 пунктов не должен превращать один кадр
// перетаскивания в обход всего списка. Считаем не миллисекунды (в jsdom они
// нерепрезентативны), а число дорогих операций: чтений геометрии
// (getBoundingClientRect) и проверок item-селектора (matches) за кадр.
//
// Первый кадр после старта делает одну O(n) классификацию детей (кэш matches пуст),
// дальше результат берётся из WeakMap. Поэтому замеры снимаются в установившемся
// режиме — после «прогрева» одним кадром.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, createMouse, wait } from './helpers.mjs';
import dragNDrop, {
    resolveContainerInsertion,
    isMonotonicLayout,
    captureRects,
} from '../index.js';

const ROW = 40;

// Плоский список из N пунктов с ручной геометрией.
const setupLarge = (count = 1000) => {
    const items = Array.from({ length: count }, (_, i) =>
        `<div class="item" data-id="i${i}">${i}</div>`
    ).join('');
    const env = setupDom(`<div class="container" id="root" data-id="root">${items}</div>`);
    const { document, layout } = env;
    const root = document.querySelector('#root');

    layout(root, { top: 0, left: 0, width: 400, height: count * ROW });
    [...root.children].forEach((el, i) => {
        layout(el, { top: i * ROW, left: 0, width: 400, height: ROW });
    });

    return { ...env, root };
};

// Счётчик вызовов метода прототипа на время одного замера.
const countCalls = (document, name, fn) => {
    const proto = document.defaultView.Element.prototype;
    const original = proto[name];
    let calls = 0;
    proto[name] = function (...args) {
        calls += 1;
        return original.apply(this, args);
    };
    try {
        fn();
    } finally {
        proto[name] = original;
    }
    return calls;
};

// Старт перетаскивания + один кадр «прогрева», чтобы кэш классификации заполнился.
const startAndWarmUp = async (root, document, flushFrames, options = {}) => {
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({
        containerSelector: '#root', itemSelector: '.item', dragDelay: 5, ...options,
    });
    mouse.down(root.children[0], 10, 10);
    await wait(10);
    mouse.move(10, 100 * ROW + 10);
    flushFrames();
    return { mouse, manager };
};

test('кадр перетаскивания на 1000 пунктов: геометрия читается по окну, а не по списку', async () => {
    const { root, document, flushFrames } = setupLarge(1000);
    const { mouse, manager } = await startAndWarmUp(root, document, flushFrames, { animation: true });

    // Курсор в промежуток между пунктами — самая дорогая ветка (поиск вставки).
    const rectCalls = countCalls(document, 'getBoundingClientRect', () => {
        mouse.move(10, 500 * ROW - 10);
        flushFrames();
    });

    mouse.up(10, 20);
    flushFrames();
    manager.destroy();

    // Было: обход всего списка на каждый кадр (>1000 замеров).
    // Стало: бинарный поиск вставки + FLIP только по видимым строкам.
    assert.ok(rectCalls < 100, `замеров геометрии за кадр: ${rectCalls}, ожидалось меньше 100`);
});

test('кадр перетаскивания на 1000 пунктов: item-селектор не проверяется на всём списке', async () => {
    const { root, document, flushFrames } = setupLarge(1000);
    const { mouse, manager } = await startAndWarmUp(root, document, flushFrames);

    const matchCalls = countCalls(document, 'matches', () => {
        mouse.move(10, 700 * ROW + 10);
        flushFrames();
    });

    mouse.up(10, 20);
    flushFrames();
    manager.destroy();

    // Классификация кэширована, проверка «контейнер пуст» обрывается на первом пункте.
    assert.ok(matchCalls < 100, `проверок селектора за кадр: ${matchCalls}, ожидалось меньше 100`);
});

test('resolveContainerInsertion на 1000 пунктах: ~10 замеров вместо 1000', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({ name: `i${i}` }));
    let calls = 0;
    const getRect = (el) => {
        calls += 1;
        return { top: Number(el.name.slice(1)) * ROW };
    };

    // monotonic: true — вертикальный список, бинарный поиск применим.
    const result = resolveContainerInsertion({ y: 500 * ROW - 10, items, getRect, monotonic: true });
    assert.equal(result.reference, items[500], 'найден первый пункт ниже курсора');
    assert.equal(result.position, 'before');
    assert.ok(calls <= 12, `замеров: ${calls}, ожидалось не больше 12`);

    // Ниже последнего пункта — по-прежнему null (работает обычное «внутрь»).
    assert.equal(resolveContainerInsertion({ y: 1000 * ROW + 10, items, getRect, monotonic: true }), null);
    assert.equal(resolveContainerInsertion({ y: 0, items: [], getRect, monotonic: true }), null);
});

test('resolveContainerInsertion: немонотонный layout даёт линейный поиск', () => {
    const tops = [130, 60, 150, 140];
    const items = tops.map((_, i) => ({ name: `n${i}` }));
    const getRect = (el) => ({ top: tops[Number(el.name.slice(1))] });

    // Курсор на 61: первый сверху пункт ниже — n0 (top=130), а не n2.
    const result = resolveContainerInsertion({ y: 61, items, getRect, monotonic: false });
    assert.equal(result.reference, items[0]);
});

test('resolveContainerInsertion: сетка из колонок не ломает результат', () => {
    // Два столбца: верхушки немонотонны (a0=0, b0=10, a1=100, b1=110).
    const tops = [0, 10, 100, 110];
    const items = tops.map((_, i) => ({ name: `n${i}` }));
    const getRect = (el) => ({ top: tops[Number(el.name.slice(1))] });

    // Курсор на 50: первый пункт ниже — третий (top=100), а не второй по порядку.
    const result = resolveContainerInsertion({ y: 50, items, getRect, monotonic: false });
    assert.equal(result.reference, items[2]);
});

test('isMonotonicLayout: вертикальный список монотонен, сетка — нет', () => {
    const getRect = (tops) => (el) => ({ top: tops[Number(el.name.slice(1))] });
    const items = (n) => Array.from({ length: n }, (_, i) => ({ name: `n${i}` }));

    assert.equal(isMonotonicLayout({ items: items(4), getRect: getRect([0, 40, 80, 120]) }), true);
    assert.equal(isMonotonicLayout({ items: items(4), getRect: getRect([0, 10, 100, 110]) }), true, 'равные верхушки допустимы');
    assert.equal(isMonotonicLayout({ items: items(4), getRect: getRect([0, 10, 5, 20]) }), false);
    assert.equal(isMonotonicLayout({ items: [], getRect: getRect([]) }), true, 'пустой список монотонен');
});

test('captureRects: окно отсекает невидимые пункты на 1000-строчном списке', () => {
    const { root, document } = setupLarge(1000);
    const isItem = (el) => el.classList.contains('item');
    const getRect = (el) => el.getBoundingClientRect();

    // Окно 0..800 (как первый экран) — в снимок попадают только видимые строки.
    const rects = captureRects({
        containers: [root], isItem, getRect, windowTop: 0, windowBottom: 800,
    });

    assert.ok(rects.size > 0, 'видимые строки попали в снимок');
    assert.ok(rects.size <= 24, `в снимке ${rects.size} строк, ожидалось не больше 24`);
    for (const el of rects.keys()) {
        const rect = el.getBoundingClientRect();
        assert.ok(rect.top < 800, `лишняя строка в снимке: top=${rect.top}`);
    }

    // Без окна поведение прежнее — все item-дети.
    assert.equal(captureRects({ containers: [root], isItem, getRect }).size, 1000);
});
