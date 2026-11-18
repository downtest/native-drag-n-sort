// Тесты FLIP-анимации: она не влияет на порядок, но трогает соседей.
// Проверяем и сам эффект (вызовы Web Animations API), и то, что без
// поддержки el.animate порядок всё равно применяется.
//
// В jsdom нет layout, поэтому используется «строчный» layout (useRowLayout):
// top элемента = его индекс среди детей. Вставка ghost сдвигает соседей —
// ровно так, как это делает браузер, и FLIP-инверсии есть что компенсировать.
// el.animate в jsdom отсутствует, поэтому в тестах он подменяется счётчиком.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, createMouse, wait, useRowLayout } from './helpers.mjs';
import dragNDrop from '../index.js';

// Перехват el.animate: jsdom не реализует WAAPI.
const spyAnimate = (window) => {
    const calls = [];
    const proto = window.Element.prototype;
    proto.animate = function (keyframes, options) {
        calls.push({ el: this, keyframes, options });
        return { cancel() {}, finished: Promise.resolve() };
    };
    return {
        calls,
        restore() { delete proto.animate; },
    };
};

const setup = (animation) => {
    const env = setupDom(`
        <div class="container" id="root">
            <div class="item" data-id="a">A</div>
            <div class="item" data-id="b">B</div>
            <div class="item" data-id="c">C</div>
        </div>
    `);
    const { document, window } = env;
    const root = document.querySelector('#root');
    const items = [...root.children];

    useRowLayout(env, root);

    const animate = spyAnimate(window);
    const mouse = createMouse(window, document);
    const manager = dragNDrop({
        containerSelector: '#root', itemSelector: '.item', dragDelay: 5, animation,
    });

    return { ...env, root, items, mouse, manager, animate };
};

const ids = (root) => [...root.children].map((el) => el.dataset.id);
const beginDrag = async (mouse, target, from, to, delay = 5) => {
    mouse.down(target, from.x, from.y);
    await wait(delay + 5);
    mouse.move(to.x, to.y);
};

test('animation: true инвертирует смещение соседей через el.animate', async () => {
    const { items, flushFrames, mouse, manager, animate } = setup(true);

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();

    assert.ok(animate.calls.length > 0, 'FLIP вызвал el.animate для сдвинувшихся соседей');

    // Первый keyframe — инверсия смещения, последний — исходное положение.
    const call = animate.calls[0];
    assert.equal(call.keyframes.length, 2, 'два keyframe: инверсия и место');
    assert.match(call.keyframes[0].transform, /^translate\(0px, -\d+px\)$/, 'инверсия компенсирует сдвиг');
    assert.equal(call.keyframes[1].transform, 'translate(0px, 0px)', 'возврат в исходное положение');

    // Анимация не оставляет следов: inline-стили не трогаются вовсе.
    for (const el of items) {
        assert.equal(el.style.transform, '', 'inline transform не выставляется');
        assert.equal(el.style.transition, '', 'inline transition не выставляется');
    }

    animate.restore();
    manager.destroy();
});

test('animation: число задаёт длительность и easing', async () => {
    const { items, flushFrames, mouse, manager, animate } = setup(120);

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();

    assert.ok(animate.calls.length > 0, 'анимации запущены');
    for (const call of animate.calls) {
        assert.equal(call.options.duration, 120, 'длительность из animation');
        assert.equal(call.options.easing, 'ease');
        assert.equal(call.options.fill, 'none', 'без fill — следов не остаётся');
    }

    animate.restore();
    manager.destroy();
});

test('animation не мешает порядку после drop', async () => {
    const { root, items, flushFrames, mouse, manager, animate } = setup(true);

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();
    mouse.up(10, 180);
    flushFrames();

    assert.deepEqual(ids(root), ['b', 'a', 'c'], 'порядок применён');
    assert.equal(root.querySelectorAll('.item-ghost').length, 0);
    assert.equal(manager.getState().isDragging, false);

    animate.restore();
    manager.destroy();
});

test('animation: false не вызывает el.animate', async () => {
    const { items, flushFrames, mouse, manager, animate } = setup(false);

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();

    assert.equal(animate.calls.length, 0, 'без animation анимаций нет');
    assert.deepEqual(items.map((el) => el.style.transform), ['', '', '']);

    animate.restore();
    manager.destroy();
});

test('без поддержки el.animate порядок всё равно применяется', async () => {
    // jsdom не реализует WAAPI — это и есть сценарий «старый браузер».
    const { root, items, flushFrames, mouse, manager } = setup(true);
    delete items[0].ownerDocument.defaultView.Element.prototype.animate;

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();
    mouse.up(10, 180);
    flushFrames();

    assert.deepEqual(ids(root), ['b', 'a', 'c'], 'порядок не зависит от анимации');
    assert.equal(manager.getState().isDragging, false);

    manager.destroy();
});
