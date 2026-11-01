// Тесты пользовательского поведения: старт drag, клон, установка позиции, завершение.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, createMouse, wait } from './helpers.mjs';
import dragNDrop from '../index.js';

const setup = () => {
    const env = setupDom(`
        <div class="container" id="root">
            <div class="item" data-id="a">A</div>
            <div class="item" data-id="b">B</div>
            <div class="item" data-id="c">C</div>
        </div>
    `);
    const { document, layout } = env;
    const root = document.querySelector('#root');
    const items = [...root.children];

    // Контейнер сверху вниз, элементы по 100px
    layout(root, { top: 0, left: 0, width: 400, height: 300 });
    items.forEach((el, i) => layout(el, { top: i * 100, left: 0, width: 400, height: 100 }));

    return { ...env, root, items };
};

const ids = (root) => [...root.children].map((el) => el.dataset.id);
const order = (root) => [...root.children].map((el) => (el.classList.contains('item-ghost') ? 'ghost' : el.dataset.id));

// Нажатие + ожидание dragDelay + движение
const beginDrag = async (mouse, target, from, to, delay = 5) => {
    mouse.down(target, from.x, from.y);
    await wait(delay + 5);
    mouse.move(to.x, to.y);
};

test('создание инстанса возвращает API и внедряет стили', () => {
    const { document } = setup();
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item' });

    assert.equal(typeof manager.destroy, 'function');
    assert.equal(typeof manager.cancel, 'function');
    assert.equal(typeof manager.refresh, 'function');
    assert.equal(typeof manager.getState, 'function');

    const styles = document.head.querySelectorAll('style');
    assert.equal(styles.length, 1, 'стили внедрены один раз');
    assert.match(styles[0].textContent, /\.item-clone/);
    assert.match(styles[0].textContent, /pointer-events: none/);

    manager.destroy();
    assert.equal(document.head.querySelectorAll('style').length, 0, 'стили удалены после destroy');
});

test('drag не начинается при движении меньше dragThreshold', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5, dragThreshold: 10 });

    mouse.down(items[0], 10, 10);
    await wait(15);
    mouse.move(14, 12); // смещение ~4.5px < 10
    flushFrames();

    assert.equal(manager.getState().isDragging, false, 'drag не должен стартовать');
    manager.destroy();
});

test('drag начинается после dragDelay и dragThreshold', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5, dragThreshold: 5 });
    const events = [];
    root.addEventListener('dragStart', (e) => events.push(e.type));

    mouse.down(items[0], 10, 10);
    await wait(15);
    mouse.move(30, 40);
    flushFrames();

    assert.equal(manager.getState().isDragging, true, 'drag должен начаться');
    assert.deepEqual(events, ['dragStart']);
    manager.destroy();
});

test('drag не начинается без движения даже после dragDelay', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5, dragThreshold: 5 });

    mouse.down(items[0], 10, 10);
    await wait(20);
    flushFrames();

    assert.equal(manager.getState().isDragging, false);
    manager.destroy();
});

test('клон следует за курсором и имеет cloneClass', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 120, y: 130 });
    flushFrames();

    const clone = document.body.querySelector('.item-clone');
    assert.ok(clone, 'клон добавлен в body');
    assert.equal(clone.style.left, '120px');
    assert.equal(clone.style.top, '130px');
    assert.ok(!clone.classList.contains('item-dragging'), 'в клоне нет класса перетаскивания');
    assert.equal(clone.textContent, 'A', 'клон повторяет содержимое');

    manager.destroy();
});

test('оригинал скрывается классом draggingClass во время drag', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 50, y: 50 });
    flushFrames();

    assert.ok(items[0].classList.contains('item-dragging'), 'оригинал скрыт');
    assert.equal(items[0].parentElement, root, 'оригинал остаётся в контейнере');

    manager.destroy();
    assert.ok(!items[0].classList.contains('item-dragging'), 'класс снят при destroy');
});

test('индикатор вставляется в позицию after при нижней половине', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    // тащим "a" на нижнюю половину "b" (b: 100..200)
    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();

    assert.ok(root.querySelector('.item-ghost'), 'индикатор создан');
    assert.deepEqual(order(root), ['a', 'b', 'ghost', 'c'], 'индикатор после b');
    // toIndex — итоговый индекс: [b, a, c] => 1
    assert.equal(manager.getState().toIndex, 1, 'toIndex без перетаскиваемого элемента');

    manager.destroy();
});

test('индикатор вставляется в позицию before при верхней половине', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    await beginDrag(mouse, items[2], { x: 10, y: 250 }, { x: 10, y: 130 });
    flushFrames();

    assert.deepEqual(order(root), ['a', 'ghost', 'b', 'c'], 'индикатор перед b');
    assert.equal(manager.getState().toIndex, 1);

    manager.destroy();
});

test('отпускание мыши завершает drag и перемещает элемент (reorder: dom)', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });
    const events = [];
    root.addEventListener('dragStart', () => events.push('start'));
    root.addEventListener('drop', () => events.push('drop'));
    root.addEventListener('dragEnd', () => events.push('end'));

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();
    mouse.up(10, 180);
    flushFrames();

    assert.deepEqual(events, ['start', 'drop', 'end']);
    assert.equal(manager.getState().isDragging, false, 'drag завершён');
    assert.deepEqual(ids(root), ['b', 'a', 'c'], 'элемент перемещён');
    assert.equal(root.querySelectorAll('.item-clone').length, 0, 'клон удалён');
    assert.equal(root.querySelectorAll('.item-ghost').length, 0, 'индикатор удалён');
    assert.ok(!items[0].classList.contains('item-dragging'), 'класс снят');

    manager.destroy();
});

test('drag не «залипает», если отпустить мышь без движения', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });
    const events = [];
    root.addEventListener('dragEnd', () => events.push('end'));

    mouse.down(items[0], 10, 10);
    mouse.up(10, 10); // без движения — drag не начинался
    await wait(20);
    flushFrames();

    assert.equal(manager.getState().isDragging, false);
    assert.deepEqual(events, [], 'dragEnd не эмитится, если drag не начинался');
    assert.deepEqual(ids(root), ['a', 'b', 'c'], 'порядок не изменился');

    manager.destroy();
});

test('повторное нажатие после завершения drag работает', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    // первый drag: a -> после b
    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();
    mouse.up(10, 180);
    flushFrames();

    // второй drag: c -> перед b
    const c = root.querySelector('[data-id="c"]');
    await beginDrag(mouse, c, { x: 10, y: 250 }, { x: 10, y: 110 });
    flushFrames();
    assert.equal(manager.getState().isDragging, true, 'второй drag начался');
    mouse.up(10, 110);
    flushFrames();

    assert.deepEqual(ids(root), ['c', 'b', 'a']);
    manager.destroy();
});

test('cancel() во время drag откатывает изменения и эмитит dragCancel', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });
    const events = [];
    root.addEventListener('dragCancel', () => events.push('cancel'));

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();
    manager.cancel();
    flushFrames();

    assert.deepEqual(events, ['cancel']);
    assert.equal(manager.getState().isDragging, false);
    assert.deepEqual(ids(root), ['a', 'b', 'c'], 'порядок не изменён');
    assert.equal(root.querySelectorAll('.item-ghost').length, 0);
    assert.equal(document.body.querySelectorAll('.item-clone').length, 0);

    manager.destroy();
});

test('cancel() до старта drag отменяет отложенный запуск', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 30 });

    mouse.down(items[0], 10, 10);
    manager.cancel();
    await wait(60);
    mouse.move(100, 100);
    flushFrames();

    assert.equal(manager.getState().isDragging, false, 'drag не должен стартовать после cancel');
    manager.destroy();
});

test('режим manual не меняет DOM, но сообщает цель через drop', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({
        containerSelector: '#root', itemSelector: '.item', dragDelay: 5, reorder: 'manual',
    });
    let payload = null;
    root.addEventListener('drop', (e) => { payload = e.detail; });

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();
    mouse.up(10, 180);
    flushFrames();

    assert.deepEqual(ids(root), ['a', 'b', 'c'], 'DOM не изменён');
    assert.equal(payload.itemId, 'a');
    assert.equal(payload.fromIndex, 0);
    // [b, a, c] => итоговый индекс 1
    assert.equal(payload.toIndex, 1);

    manager.destroy();
});

test('canDrag: false блокирует перетаскивание элемента', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({
        containerSelector: '#root', itemSelector: '.item', dragDelay: 5,
        canDrag: (el) => el.dataset.id !== 'a',
    });

    mouse.down(items[0], 10, 10);
    await wait(15);
    mouse.move(50, 50);
    flushFrames();
    assert.equal(manager.getState().isDragging, false, 'a заблокирован');

    mouse.up(50, 50);
    await beginDrag(mouse, items[1], { x: 10, y: 150 }, { x: 50, y: 150 });
    flushFrames();
    assert.equal(manager.getState().isDragging, true, 'b разрешён');

    manager.destroy();
});

test('handleSelector: drag начинается только с ручки', async () => {
    const { document, layout, flushFrames } = setupDom(`
        <div class="container" id="root">
            <div class="item" data-id="a"><span class="handle">::</span><span class="body">A</span></div>
        </div>
    `);
    const root = document.querySelector('#root');
    const item = root.children[0];
    const handle = item.querySelector('.handle');
    const body = item.querySelector('.body');
    layout(root, { top: 0, left: 0, width: 400, height: 100 });
    layout(item, { top: 0, left: 0, width: 400, height: 100 });
    layout(handle, { top: 0, left: 0, width: 20, height: 100 });
    layout(body, { top: 0, left: 20, width: 380, height: 100 });

    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({
        containerSelector: '#root', itemSelector: '.item', handleSelector: '.handle', dragDelay: 5,
    });

    await beginDrag(mouse, body, { x: 200, y: 50 }, { x: 250, y: 50 });
    flushFrames();
    assert.equal(manager.getState().isDragging, false, 'не с ручки — drag не начался');

    mouse.up(250, 50);
    await beginDrag(mouse, handle, { x: 5, y: 50 }, { x: 50, y: 50 });
    flushFrames();
    assert.equal(manager.getState().isDragging, true, 'с ручки — drag начался');

    manager.destroy();
});

test('disabled блокирует drag и снимается через refresh', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5, disabled: true });

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 50, y: 50 });
    flushFrames();
    assert.equal(manager.getState().isDragging, false);

    mouse.up(50, 50);
    manager.refresh({ disabled: false });
    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 50, y: 50 });
    flushFrames();
    assert.equal(manager.getState().isDragging, true);

    manager.destroy();
});
