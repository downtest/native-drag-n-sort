// Стабильность индикатора: промежутки между пунктами и вложенные списки.
//
// Дефект, который здесь закреплён: в списке с промежутками (gap) курсор,
// попавший между двумя пунктами, находит hit-test'ом контейнер, а не пункт.
// Ветка «курсор над вложенным контейнером» клала индикатор через appendChild —
// то есть в конец списка. Индикатор прыгал вперёд и сразу назад: визуально
// он мерцал между 2-й и 3-й позицией, а чтобы встать вторым, приходилось
// уводить курсор на заголовок первого пункта.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, createMouse, wait } from './helpers.mjs';
import dragNDrop from '../index.js';

// Геометрия как в демо (px, сверху вниз):
//   first 8..28, second 48..168, вложенный second-c 67..167
//   s1 67..87, s2 107..127, s3 147..167, third 188..208
// Промежутки s1/s2 (87..107) и s2/s3 (127..147) — пустые места списка.
const setup = () => {
    const env = setupDom(`
        <div class="container" id="root" data-id="root">
            <div class="item" data-id="first"><div class="item--title">First</div>
                <div class="item--children container" data-id="first-c"></div></div>
            <div class="item" data-id="second"><div class="item--title">Second</div>
                <div class="item--children container" data-id="second-c">
                    <div class="item" data-id="s1"><div class="item--title">Sub-First</div></div>
                    <div class="item" data-id="s2"><div class="item--title">Sub-Second</div></div>
                    <div class="item" data-id="s3"><div class="item--title">Sub-Third</div></div>
                </div></div>
            <div class="item" data-id="third"><div class="item--title">Third</div>
                <div class="item--children container" data-id="third-c"></div></div>
        </div>
    `);
    const { document, layout } = env;
    const root = document.querySelector('#root');
    const byId = (id) => document.querySelector(`[data-id="${id}"]`);
    const box = (id, top, height) => layout(byId(id), { top, left: 0, width: 400, height });

    layout(root, { top: 0, left: 0, width: 400, height: 400 });
    box('first', 8, 20);
    box('first-c', 27, 1);
    box('second', 48, 120);
    box('second-c', 67, 100);
    box('s1', 67, 20);
    box('s2', 107, 20);
    box('s3', 147, 20);
    box('third', 188, 20);
    box('third-c', 207, 1);

    return { ...env, root, byId };
};

const beginDrag = async (mouse, target, from, to, delay = 5) => {
    mouse.down(target, from.x, from.y);
    await wait(delay + 5);
    mouse.move(to.x, to.y);
};

// Плавный проход курсора по вертикали с шагом 1px.
// Мерцание — это возврат к прежней цели через одну (A -> B -> A).
const sweep = (mouse, manager, x, from, to) => {
    const targets = [];
    const step = from > to ? -1 : 1;
    for (let y = from; step < 0 ? y >= to : y <= to; y += step) {
        mouse.move(x, y);
        const { toContainerId, toIndex, position } = manager.getState();
        targets.push(`${toContainerId}/${toIndex}/${position}`);
    }

    let flickers = 0;
    for (let i = 2; i < targets.length; i += 1) {
        if (targets[i] === targets[i - 2] && targets[i] !== targets[i - 1]) flickers += 1;
    }
    return { targets, flickers };
};

test('промежуток между пунктами: индикатор встаёт перед следующим, а не в конец списка', async () => {
    const { document, flushFrames, byId } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    await beginDrag(mouse, byId('third'), { x: 10, y: 198 }, { x: 10, y: 198 });
    flushFrames();

    // y=137 — промежуток между s2 (107..127) и s3 (147..167).
    mouse.move(10, 137);
    flushFrames();

    const state = manager.getState();
    assert.equal(state.toContainerId, 'second-c');
    assert.equal(state.position, 'before', 'промежуток — позиция перед следующим пунктом');
    assert.equal(state.toIndex, 2, 'индикатор второй, а не последний');
    assert.equal(
        document.querySelector('.item-ghost').nextElementSibling.dataset.id,
        's3',
        'индикатор стоит непосредственно перед s3',
    );

    manager.destroy();
});

test('ниже последнего пункта: индикатор в конце списка (appendChild остаётся)', async () => {
    // Отдельная геометрия: вложенный список выше своих пунктов, поэтому ниже s3
    // остаётся пустое место — там позиция «в конец списка», как и раньше.
    const env = setup();
    const { document, flushFrames, byId, layout } = env;
    layout(byId('second-c'), { top: 67, left: 0, width: 400, height: 130 });

    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    await beginDrag(mouse, byId('first'), { x: 10, y: 18 }, { x: 10, y: 18 });
    flushFrames();

    // y=185 — ниже s3 (147..167), но внутри second-c (67..197).
    mouse.move(10, 185);
    flushFrames();

    assert.equal(manager.getState().toContainerId, 'second-c');
    assert.equal(manager.getState().position, 'in');
    assert.equal(manager.getState().toIndex, 3, 'конец вложенного списка');

    manager.destroy();
});

test('третий пункт встаёт вторым уже на втором пункте', async () => {
    const { document, flushFrames, byId } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    await beginDrag(mouse, byId('third'), { x: 10, y: 198 }, { x: 10, y: 198 });
    flushFrames();

    // y=55 — заголовок второго пункта (48..67), до вложенного списка.
    // Именно здесь пользователь ждёт «третий стал вторым».
    mouse.move(10, 55);
    flushFrames();

    assert.equal(manager.getState().toContainerId, 'root');
    assert.equal(manager.getState().toIndex, 1, 'индикатор встал на место второго пункта');
    assert.equal(manager.getState().position, 'before');

    manager.destroy();
});

test('плавное движение вверх и вниз не даёт мерцания индикатора', async () => {
    const { document, flushFrames, byId } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    await beginDrag(mouse, byId('third'), { x: 10, y: 198 }, { x: 10, y: 198 });
    flushFrames();

    const up = sweep(mouse, manager, 10, 198, 60);
    assert.equal(up.flickers, 0, `движение вверх без A->B->A: ${up.targets.join(' ')}`);

    const down = sweep(mouse, manager, 10, 60, 198);
    assert.equal(down.flickers, 0, `движение вниз без A->B->A: ${down.targets.join(' ')}`);

    manager.destroy();
});

test('цель не зависит от собственного прошлого: заход с любой стороны даёт ту же позицию', async () => {
    const fromBottom = setup();
    const bottomMouse = createMouse(fromBottom.document.defaultView, fromBottom.document);
    const bottomManager = dragNDrop({
        containerSelector: '.container', itemSelector: '.item', dragDelay: 5,
    });
    await beginDrag(bottomMouse, fromBottom.byId('third'), { x: 10, y: 198 }, { x: 10, y: 198 });
    fromBottom.flushFrames();
    bottomMouse.move(10, 137);
    fromBottom.flushFrames();
    const viaBottom = bottomManager.getState();
    bottomManager.destroy();

    const fromTop = setup();
    const topMouse = createMouse(fromTop.document.defaultView, fromTop.document);
    const topManager = dragNDrop({
        containerSelector: '.container', itemSelector: '.item', dragDelay: 5,
    });
    await beginDrag(topMouse, fromTop.byId('first'), { x: 10, y: 18 }, { x: 10, y: 18 });
    fromTop.flushFrames();
    topMouse.move(10, 137);
    fromTop.flushFrames();
    const viaTop = topManager.getState();
    topManager.destroy();

    assert.equal(viaBottom.toContainerId, viaTop.toContainerId);
    assert.equal(viaBottom.toIndex, viaTop.toIndex);
    assert.equal(viaBottom.position, viaTop.position);
});

// Раскладка, которая зависит от наличия детей в контейнере — как `.item--children:empty`
// в CSS: пустой список не занимает места, а с ребёнком добавляет padding и высоту.
// Именно эта зависимость замыкала обратную связь: индикатор внутри пустого списка
// растягивал пункт, курсор оказывался в другой зоне, индикатор возвращался.
const setupLiveLayout = () => {
    const env = setupDom(`
        <div class="container" id="root" data-id="root">
            <div class="item" data-id="a"><div class="container" data-id="a-c"></div></div>
            <div class="item" data-id="b"><div class="container" data-id="b-c"></div></div>
            <div class="item" data-id="c"><div class="container" data-id="c-c"></div></div>
        </div>
    `);
    const { window, document } = env;
    const root = document.querySelector('#root');

    const ITEM_HEIGHT = 40;
    const CHILD_HEIGHT = 40;
    const GAP = 20;
    const PADDING = 10;

    const childOf = (el) => [...el.children].find((child) => child.classList.contains('container'));
    const heightOf = (el) => {
        const child = childOf(el);
        const inner = child && child.children.length ? PADDING + CHILD_HEIGHT : 0;
        return ITEM_HEIGHT + inner;
    };

    const rects = new Map();
    const place = (el, top) => {
        const height = heightOf(el);
        rects.set(el, { top, bottom: top + height, height, left: 0, right: 400, width: 400 });
        let cursor = top + ITEM_HEIGHT;
        for (const child of el.children) {
            place(child, cursor);
            cursor += heightOf(child);
        }
    };

    const relayout = () => {
        rects.clear();
        place(root, 0);
    };

    window.Element.prototype.getBoundingClientRect = function () {
        const r = rects.get(this) || { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 };
        return { ...r, x: r.left, y: r.top, toJSON() { return this; } };
    };

    document.elementsFromPoint = (x, y) => {
        relayout();
        let deepest = null;
        let depth = -1;
        for (const [el, r] of rects) {
            if (y < r.top || y > r.bottom || x < r.left || x > r.right) continue;
            let d = 0;
            let node = el;
            while (node && node !== document.body) { d += 1; node = node.parentElement; }
            if (d > depth) { deepest = el; depth = d; }
        }
        if (!deepest) return [document.body];

        const chain = [];
        let node = deepest;
        while (node && node !== document.body) { chain.push(node); node = node.parentElement; }
        chain.push(document.body);
        return chain;
    };

    return { ...env, root, relayout, heightOf, rects };
};

test('дрожание: на время измерения индикатор вынут из DOM, а не скрыт', async () => {
    const env = setupLiveLayout();
    const { document, flushFrames, root } = env;
    const byId = (id) => document.querySelector(`[data-id="${id}"]`);

    env.relayout();

    // display: none оставляет индикатор ребёнком списка, и тогда :empty перестаёт
    // действовать: пустой список с padding растягивает пункт, курсор уходит из зоны.
    // Поэтому проверяем именно отсутствие индикатора в DOM в момент замера.
    const presence = [];
    let ghostRef = null;
    const originalFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = (x, y) => {
        if (ghostRef) presence.push(ghostRef.parentElement !== null);
        return originalFromPoint(x, y);
    };

    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    const cRect = env.rects.get(byId('c'));
    await beginDrag(mouse, byId('c'), { x: 10, y: cRect.top + 20 }, { x: 10, y: cRect.top + 20 });
    flushFrames();

    // Ведём вверх через верхнюю часть пунктов — там, где индикатор дрожал.
    const bTop = env.rects.get(byId('b')).top;
    const targets = [];
    for (let y = cRect.top; y >= bTop - 4; y -= 1) {
        mouse.move(10, y);
        flushFrames();
        ghostRef = document.querySelector('.item-ghost') || ghostRef;
        const state = manager.getState();
        targets.push(`${state.toContainerId}/${state.toIndex}/${state.position}`);
    }

    assert.ok(presence.length > 10, `замеров было достаточно: ${presence.length}`);
    assert.equal(
        presence.filter(Boolean).length,
        0,
        'ни один замер не выполнялся при индикаторе внутри DOM',
    );

    let flickers = 0;
    for (let i = 2; i < targets.length; i += 1) {
        if (targets[i] === targets[i - 2] && targets[i] !== targets[i - 1]) flickers += 1;
    }
    assert.equal(flickers, 0, `движение по верхней части пункта без дрожания: ${targets.join(' ')}`);

    manager.destroy();
});
