// UX-тесты: что видит и получает пользователь во время перетаскивания и после него.
// Датасеты различаются задержкой старта, скоростью движения, целевым списком и позицией,
// но проверяют одни и те же инварианты:
//   - до drop списки не меняются, оригинал скрыт, но остаётся на своём месте;
//   - ghost стоит ровно в том контейнере и на том индексе, куда попадёт элемент;
//   - после drop ghost и клон исчезают, элемент пропадает со старого места
//     и появляется на позиции ghost;
//   - payload событий описывает именно это перемещение.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, createMouse, wait } from './helpers.mjs';
import dragNDrop from '../index.js';

// Два списка рядом:
//   #left  (x 0..400)   a, b, c  — по 100px
//   #right (x 500..900) d, e     — по 100px
const setup = () => {
    const env = setupDom(`
        <div class="container" id="left" data-id="left">
            <div class="item" data-id="a">A</div>
            <div class="item" data-id="b">B</div>
            <div class="item" data-id="c">C</div>
        </div>
        <div class="container" id="right" data-id="right">
            <div class="item" data-id="d">D</div>
            <div class="item" data-id="e">E</div>
        </div>
    `);
    const { document, layout } = env;
    const left = document.querySelector('#left');
    const right = document.querySelector('#right');
    const [a, b, c] = [...left.children];
    const [d, e] = [...right.children];

    layout(left, { top: 0, left: 0, width: 400, height: 300 });
    layout(right, { top: 0, left: 500, width: 400, height: 200 });
    [a, b, c].forEach((el, i) => layout(el, { top: i * 100, left: 0, width: 400, height: 100 }));
    [d, e].forEach((el, i) => layout(el, { top: i * 100, left: 500, width: 400, height: 100 }));

    return { ...env, left, right, a, b, c, d, e };
};

// Порядок детей с пометкой индикатора: ['a', 'ghost', 'b']
const order = (container) =>
    [...container.children].map((el) => (el.classList.contains('item-ghost') ? 'ghost' : el.dataset.id));

// Индекс ghost в его контейнере, посчитанный без перетаскиваемого элемента —
// ровно так же, как это делает модуль в payload.
const ghostIndex = (document, dragged) => {
    const ghost = document.querySelector('.item-ghost');
    if (!ghost) return null;
    let index = 0;
    for (const el of ghost.parentElement.children) {
        if (!el.matches('.item')) continue;
        if (el === dragged) continue;
        if (el === ghost) return index;
        index += 1;
    }
    return -1;
};

const cloneInBody = (document) => document.body.querySelector('.item-clone');
const ghosts = (document) => document.querySelectorAll('.item-ghost');
const dragging = (document) => document.querySelectorAll('.item-dragging');

const beginDrag = async (mouse, target, from, to, delay = 5) => {
    mouse.down(target, from.x, from.y);
    await wait(delay + 5);
    mouse.move(to.x, to.y);
};

test('во время drag списки не меняются: оригинал скрыт на месте, ghost показывает будущую позицию', async () => {
    const { left, right, a, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    await beginDrag(mouse, a, { x: 10, y: 10 }, { x: 510, y: 30 });
    flushFrames();

    const state = manager.getState();
    assert.equal(state.isDragging, true);
    assert.equal(state.itemId, 'a');
    assert.equal(state.fromContainerId, 'left');
    assert.equal(state.fromIndex, 0);
    assert.equal(state.toContainerId, 'right');
    assert.equal(state.toIndex, 0);
    assert.equal(state.position, 'before');

    assert.deepEqual(order(left), ['a', 'b', 'c'], 'исходный список не изменился');
    assert.equal(a.parentElement, left, 'оригинал остаётся в исходном списке');
    assert.ok(a.classList.contains('item-dragging'), 'оригинал скрыт, но место сохранено');

    assert.deepEqual(order(right), ['ghost', 'd', 'e'], 'ghost стоит там, куда встанет элемент');
    assert.equal(ghostIndex(document, a), state.toIndex, 'индекс ghost совпадает с toIndex');
    assert.equal(ghosts(document).length, 1, 'индикатор в единственном экземпляре');
    assert.equal(cloneInBody(document).style.left, '510px', 'клон под курсором');
    assert.equal(cloneInBody(document).style.top, '30px');

    manager.destroy();
});

test('после drop элемент исчезает из старого списка и появляется на позиции ghost', async () => {
    const { left, right, a, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });
    const events = [];
    for (const type of ['dragStart', 'drop', 'dragEnd']) {
        left.addEventListener(type, (e) => events.push({ type, detail: e.detail }));
    }

    await beginDrag(mouse, a, { x: 10, y: 10 }, { x: 510, y: 190 });
    flushFrames();
    const ghostContainer = document.querySelector('.item-ghost').parentElement;
    const ghostPosition = ghostIndex(document, a);

    mouse.up(510, 190);
    flushFrames();

    assert.deepEqual(order(left), ['b', 'c'], 'из старого списка элемент исчез');
    assert.deepEqual(order(right), ['d', 'e', 'a'], 'в новом списке он ровно на месте ghost');
    assert.equal(a.parentElement, right);
    assert.equal(right.children[ghostPosition], a, 'позиция совпала с показанной пользователю');
    assert.equal(ghostContainer, right);
    assert.equal(ghosts(document).length, 0, 'ghost удалён');
    assert.equal(cloneInBody(document), null, 'клон удалён');
    assert.equal(dragging(document).length, 0, 'класс перетаскивания снят');

    assert.deepEqual(events.map((e) => e.type), ['dragStart', 'drop', 'dragEnd']);
    const [start, drop, end] = events.map((e) => e.detail);
    assert.deepEqual(drop, {
        itemId: 'a',
        fromContainerId: 'left',
        fromIndex: 0,
        toContainerId: 'right',
        toIndex: 2,
        position: 'after',
    });
    assert.deepEqual(end, drop, 'dragEnd сообщает тот же результат перемещения');
    assert.equal(start.itemId, 'a', 'dragStart знает, что тащат');
    assert.equal(start.fromIndex, 0);
    assert.equal(start.toContainerId, 'right', 'dragStart сообщает и стартовую цель');

    manager.destroy();
});

// Разные позиции в разных списках: before / after / in / возврат на место.
const positionCases = [
    {
        name: 'в начало второго списка',
        dragged: 'a',
        from: { x: 10, y: 10 },
        to: { x: 510, y: 30 },
        expect: { toContainerId: 'right', toIndex: 0, position: 'before' },
        expectLeft: ['b', 'c'],
        expectRight: ['a', 'd', 'e'],
    },
    {
        name: 'в конец второго списка',
        dragged: 'a',
        from: { x: 10, y: 10 },
        to: { x: 510, y: 190 },
        expect: { toContainerId: 'right', toIndex: 2, position: 'after' },
        expectLeft: ['b', 'c'],
        expectRight: ['d', 'e', 'a'],
    },
    {
        name: 'в середину второго списка',
        dragged: 'c',
        from: { x: 10, y: 250 },
        to: { x: 510, y: 60 },
        expect: { toContainerId: 'right', toIndex: 1, position: 'after' },
        expectLeft: ['a', 'b'],
        expectRight: ['d', 'c', 'e'],
    },
    {
        name: 'в середину своего списка',
        dragged: 'a',
        from: { x: 10, y: 10 },
        to: { x: 10, y: 180 },
        expect: { toContainerId: 'left', toIndex: 1, position: 'after' },
        expectLeft: ['b', 'a', 'c'],
        expectRight: ['d', 'e'],
    },
    {
        name: 'в начало своего списка',
        dragged: 'c',
        from: { x: 10, y: 250 },
        to: { x: 10, y: 30 },
        expect: { toContainerId: 'left', toIndex: 0, position: 'before' },
        expectLeft: ['c', 'a', 'b'],
        expectRight: ['d', 'e'],
    },
];

for (const testCase of positionCases) {
    test(`позиция ghost совпадает с итоговой вставкой: ${testCase.name}`, async () => {
        const env = setup();
        const { left, right, document, flushFrames } = env;
        const mouse = createMouse(document.defaultView, document);
        const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });
        const dragged = env[testCase.dragged];

        await beginDrag(mouse, dragged, testCase.from, testCase.to);
        flushFrames();

        const state = manager.getState();
        assert.equal(state.toContainerId, testCase.expect.toContainerId);
        assert.equal(state.toIndex, testCase.expect.toIndex);
        assert.equal(state.position, testCase.expect.position);

        const target = testCase.expect.toContainerId === 'right' ? right : left;
        const ghost = document.querySelector('.item-ghost');
        assert.equal(ghost.parentElement, target, 'ghost в нужном списке');
        assert.equal(ghostIndex(document, dragged), state.toIndex, 'ghost на нужном индексе');
        assert.deepEqual(order(left).filter((id) => id !== 'ghost'), ['a', 'b', 'c'], 'состав списка не изменился');
        assert.deepEqual(order(right).filter((id) => id !== 'ghost'), ['d', 'e'], 'состав списка не изменился');

        mouse.up(testCase.to.x, testCase.to.y);
        flushFrames();

        assert.deepEqual(order(left), testCase.expectLeft, 'итоговый порядок в первом списке');
        assert.deepEqual(order(right), testCase.expectRight, 'итоговый порядок во втором списке');
        assert.equal(dragged.parentElement, target, 'элемент в целевом списке');
        assert.equal([...target.children].indexOf(dragged), testCase.expect.toIndex,
            'индекс элемента совпадает с toIndex из события');
        assert.equal(ghosts(document).length, 0);
        assert.equal(cloneInBody(document), null);

        manager.destroy();
    });
}

// Разный dragDelay: старт строго после задержки, но при уже пройденном пороге.
for (const dragDelay of [0, 5, 20]) {
    test(`dragDelay ${dragDelay}ms: drag не стартует раньше и стартует после`, async () => {
        const { a, document, flushFrames } = setup();
        const mouse = createMouse(document.defaultView, document);
        const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay });

        mouse.down(a, 10, 10);
        mouse.move(10, 120);
        flushFrames();
        assert.equal(manager.getState().isDragging, false, 'до истечения задержки drag не начат');

        await wait(dragDelay + 10);
        flushFrames();
        assert.equal(manager.getState().isDragging, true, 'после задержки drag начался без нового движения');

        mouse.up(10, 120);
        flushFrames();
        assert.equal(manager.getState().isDragging, false);

        manager.destroy();
    });
}

test('медленное перетаскивание: по одному dragMove на кадр, цель уточняется по шагам', async () => {
    const { left, right, a, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });
    const moves = [];
    left.addEventListener('dragMove', (e) => moves.push(e.detail));

    await beginDrag(mouse, a, { x: 10, y: 10 }, { x: 510, y: 30 }); // старт drag
    flushFrames();
    moves.length = 0;

    // шагаем вниз по правому списку, отрисовывая каждый кадр
    const steps = [60, 120, 180, 190];
    for (const y of steps) {
        mouse.move(510, y);
        flushFrames();
    }

    assert.equal(moves.length, steps.length, 'каждое новое положение дало событие');
    assert.deepEqual(moves.map((m) => [m.toIndex, m.position]), [
        [1, 'after'],   // y=60  — нижняя половина 'd'
        [1, 'before'],  // y=120 — верхняя половина 'e' (та же позиция, другая зона)
        [2, 'after'],   // y=180 — нижняя половина 'e'
        [2, 'after'],   // y=190 — та же цель
    ]);
    assert.ok(moves.every((m) => m.toContainerId === 'right' && m.itemId === 'a'));
    assert.ok(moves.every((m) => m.fromIndex === 0 && m.fromContainerId === 'left'));
    assert.deepEqual(order(right), ['d', 'e', 'ghost']);

    manager.destroy();
});

test('быстрое перетаскивание: несколько движений в одном кадре дают одно событие', async () => {
    const { left, right, a, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });
    const moves = [];
    left.addEventListener('dragMove', (e) => moves.push(e.detail));

    await beginDrag(mouse, a, { x: 10, y: 10 }, { x: 510, y: 30 });
    flushFrames();
    moves.length = 0;

    // три движения подряд без отрисовки кадра — как при быстром рывке мышью
    mouse.move(510, 80);
    mouse.move(510, 140);
    mouse.move(510, 190);
    flushFrames();

    assert.equal(moves.length, 1, 'троттлинг: один расчёт на кадр');
    assert.deepEqual(order(right), ['d', 'e', 'ghost'], 'цель посчитана по последней точке');
    assert.equal(manager.getState().toIndex, 2);
    assert.equal(moves[0].toIndex, 2);

    manager.destroy();
});

test('прыжок сразу к цели: drop без промежуточных кадров применяет стартовую цель', async () => {
    const { left, right, a, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });
    let drop = null;
    left.addEventListener('drop', (e) => { drop = e.detail; });

    // движение стартует drag и сразу считает цель; кадр не отрисовывается
    await beginDrag(mouse, a, { x: 10, y: 10 }, { x: 510, y: 30 });
    mouse.up(510, 30);
    flushFrames();

    assert.equal(drop.toContainerId, 'right');
    assert.equal(drop.toIndex, 0);
    assert.deepEqual(order(right), ['a', 'd', 'e'], 'элемент вставлен в начало второго списка');
    assert.deepEqual(order(left), ['b', 'c']);

    manager.destroy();
});

test('ghost переезжает между списками, не оставляя следов в прежнем', async () => {
    const { left, right, a, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    await beginDrag(mouse, a, { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();
    assert.equal(document.querySelector('.item-ghost').parentElement, left, 'ghost в своём списке');
    assert.equal(ghostIndex(document, a), 1);

    mouse.move(510, 30);
    flushFrames();
    assert.deepEqual(order(left), ['a', 'b', 'c'], 'из старого списка ghost убран');
    assert.equal(document.querySelector('.item-ghost').parentElement, right, 'и вставлен в новый');
    assert.equal(ghosts(document).length, 1, 'индикатор существует в единственном экземпляре');

    manager.destroy();
});

test('отмена во время drag: списки, ghost и клон возвращаются в исходное состояние', async () => {
    const { left, right, a, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });
    let cancelled = null;
    left.addEventListener('dragCancel', (e) => { cancelled = e.detail; });
    let dropped = false;
    left.addEventListener('drop', () => { dropped = true; });

    await beginDrag(mouse, a, { x: 10, y: 10 }, { x: 510, y: 190 });
    flushFrames();
    assert.equal(manager.getState().isDragging, true);

    manager.cancel();
    flushFrames();

    assert.deepEqual(order(left), ['a', 'b', 'c'], 'исходный список восстановлен');
    assert.deepEqual(order(right), ['d', 'e'], 'целевой список не тронут');
    assert.equal(ghosts(document).length, 0);
    assert.equal(cloneInBody(document), null);
    assert.equal(dragging(document).length, 0);
    assert.equal(dropped, false, 'drop при отмене не эмитится');
    assert.equal(cancelled.itemId, 'a', 'dragCancel сообщает, что именно отменили');
    assert.equal(cancelled.toContainerId, 'right', 'и куда элемент был бы брошен');
    assert.equal(manager.getState().isDragging, false);

    // после отмены перетаскивание снова работает
    await beginDrag(mouse, a, { x: 10, y: 10 }, { x: 510, y: 30 });
    flushFrames();
    assert.equal(manager.getState().isDragging, true, 'новый drag начался');

    manager.destroy();
});

test('reorder: manual — DOM не меняется, но payload описывает будущее перемещение', async () => {
    const { left, right, b, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({
        containerSelector: '.container', itemSelector: '.item', dragDelay: 5, reorder: 'manual',
    });
    // события эмитятся на контейнере, на котором создан инстанс (первый '.container')
    let drop = null;
    left.addEventListener('drop', (e) => { drop = e.detail; });

    await beginDrag(mouse, b, { x: 10, y: 110 }, { x: 510, y: 190 });
    flushFrames();
    mouse.up(510, 190);
    flushFrames();

    assert.deepEqual(order(left), ['a', 'b', 'c'], 'исходный DOM не тронут');
    assert.deepEqual(order(right), ['d', 'e'], 'целевой DOM не тронут');
    assert.deepEqual(drop, {
        itemId: 'b',
        fromContainerId: 'left',
        fromIndex: 1,
        toContainerId: 'right',
        toIndex: 2,
        position: 'after',
    });
    assert.equal(ghosts(document).length, 0, 'индикатор убран и в manual-режиме');
    assert.equal(manager.getState().isDragging, false);

    manager.destroy();
});

test('dragOver эмитится только при реальной смене цели', async () => {
    const { left, right, a, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });
    const overs = [];
    left.addEventListener('dragOver', (e) => overs.push(e.detail));

    await beginDrag(mouse, a, { x: 10, y: 10 }, { x: 510, y: 190 });
    flushFrames();
    const initial = overs.length;

    mouse.move(510, 180); // та же цель: right / after e
    flushFrames();
    assert.equal(overs.length, initial, 'движение внутри той же зоны не даёт dragOver');

    mouse.move(510, 30); // другая цель: right / before d
    flushFrames();
    assert.equal(overs.length, initial + 1, 'смена цели даёт ровно одно событие');
    assert.equal(overs.at(-1).toIndex, 0);
    assert.equal(overs.at(-1).position, 'before');
    assert.deepEqual(order(right), ['ghost', 'd', 'e']);

    manager.destroy();
});

test('getState() во время drag отражает живое состояние, после drop — сброшенное', async () => {
    const { left, a, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    assert.deepEqual(manager.getState(), {
        isDragging: false,
        itemId: null,
        fromContainerId: null,
        fromIndex: null,
        toContainerId: null,
        toIndex: null,
        position: null,
    }, 'до drag состояния нет');

    await beginDrag(mouse, a, { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();

    assert.deepEqual(manager.getState(), {
        isDragging: true,
        itemId: 'a',
        fromContainerId: 'left',
        fromIndex: 0,
        toContainerId: 'left',
        toIndex: 1,
        position: 'after',
    });

    mouse.up(10, 180);
    flushFrames();

    const after = manager.getState();
    assert.equal(after.isDragging, false);
    assert.equal(after.itemId, null, 'состояние очищено после завершения');
    assert.equal(after.toContainerId, null);
    assert.deepEqual(order(left), ['b', 'a', 'c']);

    manager.destroy();
});

test('drag с ручкой и разными классами: ghost и клон используют кастомные классы', async () => {
    const env = setupDom(`
        <div class="list" id="root" data-id="root">
            <div class="row" data-id="x"><span class="grip">::</span><span class="text">X</span></div>
            <div class="row" data-id="y"><span class="grip">::</span><span class="text">Y</span></div>
        </div>
    `);
    const { document, layout, flushFrames } = env;
    const root = document.querySelector('#root');
    const [x, y] = [...root.children];
    layout(root, { top: 0, left: 0, width: 400, height: 200 });
    layout(x, { top: 0, left: 0, width: 400, height: 100 });
    layout(y, { top: 100, left: 0, width: 400, height: 100 });
    layout(x.querySelector('.grip'), { top: 0, left: 0, width: 20, height: 100 });
    layout(y.querySelector('.grip'), { top: 100, left: 0, width: 20, height: 100 });

    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({
        containerSelector: '#root',
        itemSelector: '.row',
        handleSelector: '.grip',
        dragDelay: 5,
        ghostClass: 'drop-marker',
        cloneClass: 'cursor-copy',
        draggingClass: 'is-hidden',
    });

    await beginDrag(mouse, y.querySelector('.grip'), { x: 5, y: 150 }, { x: 10, y: 20 });
    flushFrames();

    assert.equal(document.querySelectorAll('.drop-marker').length, 1, 'индикатор с кастомным классом');
    assert.equal(document.querySelectorAll('.cursor-copy').length, 1, 'клон с кастомным классом');
    assert.ok(y.classList.contains('is-hidden'), 'скрытие с кастомным классом');
    assert.equal(manager.getState().toIndex, 0, 'бросок в начало списка');

    mouse.up(10, 20);
    flushFrames();

    assert.deepEqual([...root.children].map((el) => el.dataset.id), ['y', 'x'], 'порядок применён');
    assert.equal(document.querySelectorAll('.drop-marker').length, 0);
    assert.equal(document.querySelectorAll('.cursor-copy').length, 0);

    manager.destroy();
});

test('drop в пустой список: ghost сразу внутри него, toIndex 0', async () => {    const env = setupDom(`
        <div class="container" id="left" data-id="left">
            <div class="item" data-id="a">A</div>
        </div>
        <div class="container" id="empty" data-id="empty"></div>
    `);
    const { document, layout, flushFrames } = env;
    const left = document.querySelector('#left');
    const empty = document.querySelector('#empty');
    const [a] = [...left.children];
    layout(left, { top: 0, left: 0, width: 400, height: 100 });
    layout(a, { top: 0, left: 0, width: 400, height: 100 });
    layout(empty, { top: 200, left: 0, width: 400, height: 100 });

    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });
    let drop = null;
    left.addEventListener('drop', (e) => { drop = e.detail; });

    await beginDrag(mouse, a, { x: 10, y: 10 }, { x: 10, y: 250 });
    flushFrames();

    assert.equal(document.querySelector('.item-ghost').parentElement, empty, 'ghost внутри пустого списка');
    assert.equal(manager.getState().toContainerId, 'empty');
    assert.equal(manager.getState().toIndex, 0);
    assert.equal(manager.getState().position, 'in');

    mouse.up(10, 250);
    flushFrames();

    assert.deepEqual(drop, {
        itemId: 'a',
        fromContainerId: 'left',
        fromIndex: 0,
        toContainerId: 'empty',
        toIndex: 0,
        position: 'in',
    });
    assert.equal(a.parentElement, empty);
    assert.deepEqual([...empty.children].map((el) => el.dataset.id), ['a']);
    assert.equal(left.children.length, 0, 'старый список опустел');

    manager.destroy();
});

