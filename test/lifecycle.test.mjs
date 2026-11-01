// Тесты жизненного цикла и побочных эффектов: общие стили, destroy/refresh, debug,
// касания, автопрокрутка и завершение drag за пределами списка.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, createMouse, createTouch, wait } from './helpers.mjs';
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

    layout(root, { top: 0, left: 0, width: 400, height: 300 });
    items.forEach((el, i) => layout(el, { top: i * 100, left: 0, width: 400, height: 100 }));

    return { ...env, root, items };
};

const ids = (root) => [...root.children].map((el) => el.dataset.id);

test('два инстанса с одинаковыми классами делят один <style>', () => {
    const { document, root } = setup();
    const second = document.createElement('div');
    second.className = 'container';
    second.id = 'second';
    document.body.appendChild(second);

    const first = dragNDrop({ containerSelector: '#root', itemSelector: '.item' });
    const other = dragNDrop({ containerSelector: '#second', itemSelector: '.item' });

    assert.equal(document.head.querySelectorAll('style').length, 1, 'стиль общий');

    first.destroy();
    assert.equal(document.head.querySelectorAll('style').length, 1, 'стиль жив, пока есть потребитель');

    other.destroy();
    assert.equal(document.head.querySelectorAll('style').length, 0, 'стиль удалён последним потребителем');
    assert.ok(root);
});

test('инстансы с разными классами получают разные стили', () => {
    const { document } = setup();
    const second = document.createElement('div');
    second.className = 'container';
    second.id = 'second';
    document.body.appendChild(second);

    const first = dragNDrop({ containerSelector: '#root', itemSelector: '.item' });
    const other = dragNDrop({ containerSelector: '#second', itemSelector: '.item', cloneClass: 'custom-clone' });

    const css = [...document.head.querySelectorAll('style')].map((el) => el.textContent).join('\n');
    assert.match(css, /\.item-clone/);
    assert.match(css, /\.custom-clone/);

    first.destroy();
    other.destroy();
    assert.equal(document.head.querySelectorAll('style').length, 0);
});

test('destroy идемпотентен и не ломает счётчик стилей', () => {
    const { document } = setup();
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item' });

    manager.destroy();
    manager.destroy();
    manager.destroy();

    assert.equal(document.head.querySelectorAll('style').length, 0);
});

test('destroy во время drag убирает клон, индикатор и класс перетаскивания', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    mouse.down(items[0], 10, 10);
    await wait(10);
    mouse.move(10, 180);
    flushFrames();
    assert.ok(document.body.querySelector('.item-clone'), 'клон есть до destroy');

    manager.destroy();

    assert.equal(document.body.querySelectorAll('.item-clone').length, 0, 'клон удалён');
    assert.equal(root.querySelectorAll('.item-ghost').length, 0, 'индикатор удалён');
    assert.ok(!items[0].classList.contains('item-dragging'), 'класс снят');
    assert.deepEqual(ids(root), ['a', 'b', 'c'], 'порядок не изменён');
});

test('refresh с новыми классами пересобирает стили', () => {
    const { document } = setup();
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item' });
    assert.match(document.head.querySelector('style').textContent, /\.item-clone/);

    manager.refresh({ cloneClass: 'new-clone' });

    const css = [...document.head.querySelectorAll('style')].map((el) => el.textContent).join('\n');
    assert.match(css, /\.new-clone/);
    assert.doesNotMatch(css, /\.item-clone/);
    assert.equal(document.head.querySelectorAll('style').length, 1, 'старый стиль заменён, а не добавлен');

    manager.destroy();
    assert.equal(document.head.querySelectorAll('style').length, 0);
});

test('debug: оверлей на инстанс и один общий <style>', () => {
    const { document } = setup();
    const second = document.createElement('div');
    second.className = 'container';
    second.id = 'second';
    document.body.appendChild(second);

    const first = dragNDrop({ containerSelector: '#root', itemSelector: '.item', debug: true });
    const other = dragNDrop({ containerSelector: '#second', itemSelector: '.item', debug: true });

    assert.equal(document.querySelectorAll('.ds-debug-info').length, 2, 'оверлей у каждого инстанса');
    assert.equal(document.querySelectorAll('style').length, 2, 'общий стиль + debug');

    first.destroy();
    assert.equal(document.querySelectorAll('.ds-debug-info').length, 1, 'оверлей первого удалён');
    assert.equal(document.querySelectorAll('style').length, 2, 'debug-стиль ещё нужен второму');

    other.destroy();
    assert.equal(document.querySelectorAll('.ds-debug-info').length, 0);
    assert.equal(document.querySelectorAll('style').length, 0);
});

test('refresh отключает debug, когда флаг снят', () => {
    const { document } = setup();
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', debug: true });
    assert.equal(document.querySelectorAll('.ds-debug-info').length, 1);

    manager.refresh({ debug: false });
    assert.equal(document.querySelectorAll('.ds-debug-info').length, 0);

    manager.destroy();
});

test('касание: drag начинается и завершается по touchend', async () => {
    const { root, items, document, flushFrames } = setup();
    const touch = createTouch(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });
    const events = [];
    root.addEventListener('dragStart', () => events.push('start'));
    root.addEventListener('dragEnd', () => events.push('end'));

    touch.start(items[0], 10, 10);
    await wait(10);
    touch.move(10, 180);
    flushFrames();

    assert.equal(manager.getState().isDragging, true, 'drag начался по касанию');
    const clone = document.body.querySelector('.item-clone');
    assert.equal(clone.style.top, '180px', 'клон следует за касанием');

    touch.end(10, 180);
    flushFrames();

    assert.deepEqual(events, ['start', 'end']);
    assert.equal(manager.getState().isDragging, false, 'drag завершён по touchend');
    assert.deepEqual(ids(root), ['b', 'a', 'c'], 'элемент перемещён');
    assert.equal(document.body.querySelectorAll('.item-clone').length, 0, 'клон удалён');

    manager.destroy();
});

test('touchcancel завершает drag без перемещения', async () => {
    const { root, items, document, flushFrames } = setup();
    const touch = createTouch(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    touch.start(items[0], 10, 10);
    await wait(10);
    touch.move(10, 180);
    flushFrames();
    assert.equal(manager.getState().isDragging, true);

    touch.cancel(10, 180);
    flushFrames();

    assert.equal(manager.getState().isDragging, false, 'drag снят по touchcancel');
    assert.deepEqual(ids(root), ['a', 'b', 'c'], 'порядок не изменён');
    assert.equal(document.body.querySelectorAll('.item-clone').length, 0);

    manager.destroy();
});

test('отпускание мыши за пределами списка завершает drag без drop', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });
    const events = [];
    root.addEventListener('drop', () => events.push('drop'));
    root.addEventListener('dragEnd', () => events.push('end'));

    // ниже контейнера (0..300) — под курсором только body
    mouse.down(items[0], 10, 10);
    await wait(10);
    mouse.move(10, 400);
    flushFrames();

    assert.equal(manager.getState().isDragging, true, 'drag стартовал');

    mouse.up(10, 400);
    flushFrames();

    assert.deepEqual(events, ['end'], 'drop не эмитится без цели, dragEnd — эмитится');
    assert.equal(manager.getState().isDragging, false, 'drag завершён');
    assert.deepEqual(ids(root), ['a', 'b', 'c'], 'порядок не изменён');
    assert.equal(document.body.querySelectorAll('.item-clone').length, 0);
    assert.ok(!items[0].classList.contains('item-dragging'));

    manager.destroy();
});

test('автоскролл прокручивает заданный контейнер у края', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({
        containerSelector: '#root',
        itemSelector: '.item',
        dragDelay: 5,
        scrollContainer: '#root',
        scrollThreshold: 50,
        scrollSpeed: 10,
    });

    mouse.down(items[0], 10, 10);
    await wait(10);
    mouse.move(10, 290); // 10px от нижнего края контейнера
    flushFrames();

    assert.equal(root.scrollTop, 10, 'контейнер прокручен вниз на scrollSpeed');

    manager.destroy();
});

test('dragMove эмитится на каждое новое положение курсора', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });
    const moves = [];
    root.addEventListener('dragMove', (e) => moves.push([e.detail.toIndex, e.detail.position]));

    mouse.down(items[0], 10, 10);
    await wait(10);
    mouse.move(10, 120); // старт drag: цель считается сразу, dragMove не эмитится
    flushFrames();
    mouse.move(10, 180);
    flushFrames();
    mouse.move(10, 280);
    flushFrames();

    assert.equal(moves.length, 2, 'по одному dragMove на кадр');
    assert.deepEqual(moves[0], [1, 'after'], 'вставка после b');
    assert.deepEqual(moves[1], [2, 'after'], 'вставка после c');

    manager.destroy();
});
