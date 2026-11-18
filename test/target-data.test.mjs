// Тесты корректности данных о цели: id контейнеров, индексы, повторные drag
// после изменения DOM потребителем. Эти свойства важны для режима reorder: 'manual',
// где потребитель применяет перемещение по payload события drop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, createMouse, wait } from './helpers.mjs';
import dragNDrop from '../index.js';

const setup = () => {
    const env = setupDom(`
        <div class="container" id="root" data-id="root">
            <div class="item" data-id="a">A</div>
            <div class="item" data-id="b">B</div>
            <div class="item" data-id="c">C</div>
        </div>
        <div class="container" id="other" data-id="other"></div>
    `);
    const { document, layout } = env;
    const root = document.querySelector('#root');
    const other = document.querySelector('#other');
    const items = [...root.children];

    layout(root, { top: 0, left: 0, width: 400, height: 300 });
    items.forEach((el, i) => layout(el, { top: i * 100, left: 0, width: 400, height: 100 }));
    layout(other, { top: 400, left: 0, width: 400, height: 100 });

    return { ...env, root, other, items };
};

const beginDrag = async (mouse, target, from, to, delay = 5) => {
    mouse.down(target, from.x, from.y);
    await wait(delay + 5);
    mouse.move(to.x, to.y);
};

test('fromContainerId заполнен для элемента внутри контейнера', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    await beginDrag(mouse, items[1], { x: 10, y: 150 }, { x: 10, y: 250 });
    flushFrames();

    assert.equal(manager.getState().fromContainerId, 'root', 'id контейнера-источника не должен быть null');

    manager.destroy();
});

test('toIndex верен при вставке в пустой контейнер', async () => {
    const { root, other, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });
    let payload = null;
    root.addEventListener('drop', (e) => { payload = e.detail; });

    // пустой контейнер не содержит item-детей — раньше toIndex был -1
    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 450 });
    flushFrames();
    mouse.up(10, 450);
    flushFrames();

    assert.equal(payload.toContainerId, 'other');
    assert.equal(payload.toIndex, 0, 'в пустой контейнер элемент встаёт на индекс 0');
    assert.equal(payload.position, 'in');
    assert.deepEqual([...other.children].map((el) => el.dataset.id), ['a']);

    manager.destroy();
});

test('toIndex не сдвигается вложенным контейнером внутри элемента', async () => {
    const env = setupDom(`
        <div class="container" id="root" data-id="root">
            <div class="item" data-id="a">A</div>
            <div class="item" data-id="b"><div class="container" data-id="b-child"></div></div>
            <div class="item" data-id="c">C</div>
        </div>
    `);
    const { document, layout, flushFrames } = env;
    const root = document.querySelector('#root');
    const [a, b, c] = [...root.children];
    const bChild = b.querySelector('.container');

    layout(root, { top: 0, left: 0, width: 400, height: 300 });
    layout(a, { top: 0, left: 0, width: 400, height: 100 });
    layout(b, { top: 100, left: 0, width: 400, height: 100 });
    layout(bChild, { top: 160, left: 0, width: 400, height: 40 });
    layout(c, { top: 200, left: 0, width: 400, height: 100 });

    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    // тащим c в пустой bChild: индекс считается внутри вложенного списка, а не корневого
    await beginDrag(mouse, c, { x: 10, y: 250 }, { x: 10, y: 180 });
    flushFrames();

    const state = manager.getState();
    assert.equal(state.toContainerId, 'b-child');
    assert.equal(state.toIndex, 0, 'индекс внутри целевого контейнера');
    assert.equal(state.position, 'in');

    manager.destroy();
});

test('id контейнера берётся через getContainerId, если data-id не задан', async () => {
    const env = setupDom(`
        <div class="container" id="root" data-container-id="root-key">
            <div class="item" data-id="a">A</div>
            <div class="item" data-id="b">B</div>
        </div>
    `);
    const { document, layout, flushFrames } = env;
    const root = document.querySelector('#root');
    const items = [...root.children];
    layout(root, { top: 0, left: 0, width: 400, height: 200 });
    items.forEach((el, i) => layout(el, { top: i * 100, left: 0, width: 400, height: 100 }));

    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 150 });
    flushFrames();

    assert.equal(manager.getState().fromContainerId, 'root-key', 'фолбэк на data-container-id');

    manager.destroy();
});

test('новый вложенный контейнер, добавленный между drag, учитывается', async () => {
    const { root, items, document, layout, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    // первый drag: 'a' ещё плоский — модуль кэширует отсутствие вложенного контейнера
    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 280 });
    flushFrames();
    mouse.up(10, 280);
    flushFrames();
    assert.deepEqual([...root.children].map((el) => el.dataset.id), ['b', 'c', 'a']);

    // потребитель отрендерил вложенный список внутри 'a' (типично для Vue/React)
    const a = root.querySelector('[data-id="a"]');
    const child = document.createElement('div');
    child.className = 'container';
    child.dataset.id = 'a-child';
    a.appendChild(child);

    // 'a' теперь третий: 200..300, средняя треть 233..266; вложенный список ниже точки наведения
    const [b, c] = [...root.children];
    layout(b, { top: 0, left: 0, width: 400, height: 100 });
    layout(c, { top: 100, left: 0, width: 400, height: 100 });
    layout(a, { top: 200, left: 0, width: 400, height: 100 });
    layout(child, { top: 260, left: 0, width: 400, height: 40 });

    // второй drag над средней третью 'a' — должна работать зона in
    await beginDrag(mouse, b, { x: 10, y: 50 }, { x: 10, y: 240 });
    flushFrames();

    const state = manager.getState();
    assert.equal(state.position, 'in', 'элемент с новым вложенным контейнером имеет зону in');
    assert.equal(state.toContainerId, 'a-child');

    manager.destroy();
});

test('правой кнопкой мыши drag не начинается', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item', dragDelay: 5 });

    mouse.down(items[0], 10, 10, 2);
    await wait(10);
    mouse.move(10, 180, 2);

    assert.equal(manager.getState().isDragging, false, 'контекстное меню не должно запускать drag');
    assert.equal(document.body.querySelectorAll('.item-clone').length, 0);

    manager.destroy();
});
