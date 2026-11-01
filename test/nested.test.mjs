// Тесты вложенных списков: выбор зоны in/before/after и перенос между уровнями.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, createMouse, wait } from './helpers.mjs';
import dragNDrop from '../index.js';

// Дерево на 3 уровня:
//   root
//     ├ a
//     ├ b  (вложенный контейнер bChild: b1, b2)
//     └ c
const setupNested = () => {
    const env = setupDom(`
        <div class="container" id="root" data-id="root">
            <div class="item" data-id="a"><div class="title">A</div><div class="container" data-id="a-child"></div></div>
            <div class="item" data-id="b">
                <div class="title">B</div>
                <div class="container" data-id="b-child">
                    <div class="item" data-id="b1"><div class="title">B1</div></div>
                    <div class="item" data-id="b2"><div class="title">B2</div></div>
                </div>
            </div>
            <div class="item" data-id="c"><div class="title">C</div><div class="container" data-id="c-child"></div></div>
        </div>
    `);
    const { document, layout } = env;
    const root = document.querySelector('#root');
    const [a, b, c] = [...root.children];
    const bChild = b.querySelector('[data-id="b-child"]');
    const b1 = b.querySelector('[data-id="b1"]');
    const b2 = b.querySelector('[data-id="b2"]');

    // b занимает 200..500 (треть = 100px): before 200..300, in 300..400, after 400..500.
    // bChild начинается с 330 — так средняя треть b остаётся доступной вне вложенного списка.
    // Ниже b2 (430..500) оставлена пустая зона вложенного списка.
    layout(root, { top: 0, left: 0, width: 400, height: 900 });
    layout(a, { top: 0, left: 0, width: 400, height: 200 });
    layout(b, { top: 200, left: 0, width: 400, height: 300 });
    layout(c, { top: 500, left: 0, width: 400, height: 200 });
    layout(bChild, { top: 330, left: 0, width: 400, height: 170 });
    layout(b1, { top: 330, left: 0, width: 400, height: 50 });
    layout(b2, { top: 380, left: 0, width: 400, height: 50 });

    return { ...env, root, a, b, c, bChild, b1, b2 };
};

const ids = (root) => [...root.children].map((el) => (el.classList.contains('item-ghost') ? 'ghost' : el.dataset.id));

const beginDrag = async (mouse, target, from, to, delay = 5) => {
    mouse.down(target, from.x, from.y);
    await wait(delay + 5);
    mouse.move(to.x, to.y);
};

test('средняя треть элемента с вложенным списком даёт позицию in', async () => {
    const { root, b, bChild, document, flushFrames } = setupNested();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    // тащим a в среднюю треть b (300..400), ещё вне bChild (330..500)
    await beginDrag(mouse, root.children[0], { x: 10, y: 20 }, { x: 10, y: 310 });
    flushFrames();

    const ghost = bChild.querySelector('.item-ghost');
    assert.ok(ghost, 'индикатор внутри вложенного контейнера');
    assert.equal(manager.getState().position, 'in');
    assert.equal(manager.getState().toContainerId, 'b-child');

    manager.destroy();
});

test('курсор над вложенным контейнером даёт позицию in в этот контейнер', async () => {
    const { root, bChild, document, flushFrames } = setupNested();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    // тащим c на пустое место внутри bChild (ниже b2)
    await beginDrag(mouse, root.children[2], { x: 10, y: 520 }, { x: 10, y: 460 });
    flushFrames();

    const state = manager.getState();
    assert.equal(state.position, 'in');
    assert.equal(state.toContainerId, 'b-child');
    assert.equal(state.toIndex, 2, 'вставка в конец вложенного списка');

    manager.destroy();
});

test('перенос из вложенного списка в корневой (drag из 3-го уровня наружу)', async () => {
    const { root, b1, document, flushFrames } = setupNested();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    // b1 -> нижняя треть c (633..700)
    await beginDrag(mouse, b1, { x: 10, y: 350 }, { x: 10, y: 650 });
    flushFrames();
    assert.equal(manager.getState().toContainerId, 'root');
    assert.equal(manager.getState().position, 'after');

    mouse.up(10, 650);
    flushFrames();

    assert.deepEqual(ids(root), ['a', 'b', 'c', 'b1'], 'элемент переехал в корневой список');
    assert.equal(b1.parentElement, root);
    assert.equal(manager.getState().isDragging, false);

    manager.destroy();
});

test('перенос из корневого списка во вложенный', async () => {
    const { root, bChild, document, flushFrames } = setupNested();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    // a -> внутрь bChild
    await beginDrag(mouse, root.children[0], { x: 10, y: 20 }, { x: 10, y: 460 });
    flushFrames();
    mouse.up(10, 460);
    flushFrames();

    assert.deepEqual(ids(bChild), ['b1', 'b2', 'a'], 'a попал во вложенный список');
    assert.equal(root.children[0].dataset.id, 'b', 'из корня удалён');

    manager.destroy();
});

test('нельзя бросить элемент в собственное поддерево', async () => {
    const { b, bChild, document, flushFrames } = setupNested();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    // тащим b и пытаемся бросить внутрь его же bChild
    await beginDrag(mouse, b, { x: 10, y: 210 }, { x: 10, y: 460 });
    flushFrames();

    assert.equal(bChild.querySelector('.item-ghost'), null, 'индикатор не создан в собственном поддереве');

    manager.destroy();
});

test('canDrop запрещает бросок в конкретный контейнер', async () => {
    const { root, bChild, document, flushFrames } = setupNested();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({
        containerSelector: '.container',
        itemSelector: '.item',
        dragDelay: 5,
        canDrop: (_el, target) => target !== bChild,
    });

    await beginDrag(mouse, root.children[0], { x: 10, y: 20 }, { x: 10, y: 310 });
    flushFrames();

    assert.equal(bChild.querySelector('.item-ghost'), null, 'бросок в bChild запрещён');

    manager.destroy();
});

test('глубоко вложенный список: выбор цели не зависит от глубины', async () => {
    const { document, layout, flushFrames } = setupDom(`
        <div class="container" id="root" data-id="root">
            <div class="item" data-id="l1">
                <div class="container" data-id="c1">
                    <div class="item" data-id="l2">
                        <div class="container" data-id="c2">
                            <div class="item" data-id="l3">
                                <div class="container" data-id="c3">
                                    <div class="item" data-id="l4"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="item" data-id="sibling"></div>
        </div>
    `);
    const root = document.querySelector('#root');
    const byId = (id) => document.querySelector(`[data-id="${id}"]`);
    const [l1, sibling] = [...root.children];

    layout(root, { top: 0, left: 0, width: 400, height: 400 });
    layout(l1, { top: 0, left: 0, width: 400, height: 200 });
    layout(byId('c1'), { top: 40, left: 0, width: 400, height: 160 });
    layout(byId('l2'), { top: 40, left: 0, width: 400, height: 160 });
    layout(byId('c2'), { top: 60, left: 0, width: 400, height: 140 });
    layout(byId('l3'), { top: 60, left: 0, width: 400, height: 140 });
    layout(byId('c3'), { top: 80, left: 0, width: 400, height: 120 });
    layout(byId('l4'), { top: 80, left: 0, width: 400, height: 120 });
    layout(sibling, { top: 200, left: 0, width: 400, height: 200 });

    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    // l4 (4-й уровень) -> нижняя половина sibling (2-й уровень)
    await beginDrag(mouse, byId('l4'), { x: 10, y: 90 }, { x: 10, y: 350 });
    flushFrames();

    const state = manager.getState();
    assert.equal(state.itemId, 'l4');
    assert.equal(state.fromContainerId, 'c3');
    assert.equal(state.toContainerId, 'root');
    assert.equal(state.position, 'after');

    mouse.up(10, 350);
    flushFrames();
    assert.deepEqual([...root.children].map((el) => el.dataset.id), ['l1', 'sibling', 'l4']);

    manager.destroy();
});

test('вложенный список: повторные drag между уровнями не ломают состояние', async () => {
    const { root, bChild, document, flushFrames } = setupNested();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    // a -> в bChild
    await beginDrag(mouse, root.children[0], { x: 10, y: 20 }, { x: 10, y: 460 });
    flushFrames();
    mouse.up(10, 460);
    flushFrames();
    assert.deepEqual(ids(bChild), ['b1', 'b2', 'a']);

    // a обратно в корень, в нижнюю треть c
    const a = bChild.querySelector('[data-id="a"]');
    await beginDrag(mouse, a, { x: 10, y: 100 }, { x: 10, y: 650 });
    flushFrames();
    mouse.up(10, 650);
    flushFrames();

    assert.deepEqual(ids(root), ['b', 'c', 'a']);
    assert.equal(manager.getState().isDragging, false);

    manager.destroy();
});
