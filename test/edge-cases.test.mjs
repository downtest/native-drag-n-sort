// Тесты «краевых» ветвей: ранние выходы, сброс кадров, отсутствие контейнера,
// отложенный старт по таймеру, смена контейнера через refresh, debug-индикатор.
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

    layout(root, { top: 0, left: 0, width: 400, height: 300 });
    items.forEach((el, i) => layout(el, { top: i * 100, left: 0, width: 400, height: 100 }));

    return { ...env, root, items };
};

test('без подходящего контейнера фабрика возвращает undefined', () => {
    setupDom('<div class="nothing"></div>');
    const manager = dragNDrop({ containerSelector: '.container', itemSelector: '.item' });
    assert.equal(manager, undefined, 'нет контейнера — нет инстанса');
});

test('drop вне любого контейнера не эмитится, состояние сбрасывается', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });
    const events = [];
    root.addEventListener('drop', () => events.push('drop'));
    root.addEventListener('dragEnd', () => events.push('end'));

    // курсор уходит за пределы контейнера — цели нет
    mouse.down(items[0], 10, 10);
    await wait(10);
    mouse.move(10, 500);
    flushFrames();
    assert.equal(manager.getState().position, null, 'позиция не определена');
    assert.equal(manager.getState().toIndex, null);

    mouse.up(10, 500);
    flushFrames();

    assert.deepEqual(events, ['end'], 'dragEnd без drop');
    assert.equal(manager.getState().isDragging, false);

    manager.destroy();
});

test('drag начинается по таймеру, если порог пройден до истечения dragDelay', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 25 });

    // движение сразу, до истечения задержки
    mouse.down(items[0], 10, 10);
    mouse.move(10, 120);
    flushFrames();
    assert.equal(manager.getState().isDragging, false, 'пока задержка не истекла — не начинаем');

    // таймер срабатывает уже после движения и стартует drag сам
    await wait(40);
    flushFrames();
    assert.equal(manager.getState().isDragging, true, 'таймер запустил drag без нового движения');
    assert.equal(manager.getState().itemId, 'a');

    manager.destroy();
});

test('смена containerSelector через refresh переносит обработчики', async () => {
    const env = setupDom(`
        <div class="container" id="first">
            <div class="item" data-id="a">A</div>
        </div>
        <div class="container" id="second">
            <div class="item" data-id="b">B</div>
            <div class="item" data-id="c">C</div>
        </div>
    `);
    const { document, layout, flushFrames } = env;
    const first = document.querySelector('#first');
    const second = document.querySelector('#second');
    layout(first, { top: 0, left: 0, width: 400, height: 100 });
    layout(second, { top: 200, left: 0, width: 400, height: 200 });
    layout(first.children[0], { top: 0, left: 0, width: 400, height: 100 });
    layout(second.children[0], { top: 200, left: 0, width: 400, height: 100 });
    layout(second.children[1], { top: 300, left: 0, width: 400, height: 100 });

    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#first', itemSelector: '.item', dragDelay: 5 });

    // события приходят от текущего контейнера
    const fromFirst = [];
    const fromSecond = [];
    first.addEventListener('dragStart', () => fromFirst.push(1));
    second.addEventListener('dragStart', () => fromSecond.push(1));

    manager.refresh({ containerSelector: '#second' });

    mouse.down(second.children[0], 10, 250);
    await wait(10);
    mouse.move(10, 350);
    flushFrames();

    assert.equal(manager.getState().isDragging, true, 'drag работает на новом контейнере');
    assert.deepEqual(fromSecond, [1], 'событие от нового контейнера');
    assert.deepEqual(fromFirst, [], 'старый контейнер отписан');

    // старый контейнер больше не реагирует
    mouse.up(10, 350);
    flushFrames();
    mouse.down(first.children[0], 10, 50);
    await wait(10);
    mouse.move(10, 60);
    flushFrames();
    assert.equal(manager.getState().isDragging, false, 'старый контейнер не запускает drag');

    manager.destroy();
});

test('debug: индикатор уровня курсора обновляется при движении', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5, debug: true });

    const indicator = document.querySelector('.ds-debug-cursor-level');
    assert.ok(indicator, 'индикатор создан');
    assert.equal(indicator.style.top, '', 'до движения позиция не задана');

    mouse.down(items[0], 10, 10);
    await wait(10);
    mouse.move(10, 60); // четверть высоты элемента 'a'
    flushFrames();

    assert.match(indicator.style.top, /^\d+(\.\d+)?%$/, 'позиция в процентах');
    const percent = parseFloat(indicator.style.top);
    assert.ok(percent > 0 && percent < 100, `процент внутри элемента: ${percent}`);

    manager.destroy();
    assert.equal(document.querySelector('.ds-debug-cursor-level'), null, 'индикатор удалён');
});

test('cancel() после destroy ничего не делает', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    mouse.down(items[0], 10, 10);
    await wait(10);
    mouse.move(10, 180);
    flushFrames();
    manager.destroy();

    assert.doesNotThrow(() => manager.cancel());
    assert.equal(manager.getState().isDragging, false);
});

test('refresh() после destroy не воскрешает инстанс', () => {
    const { document } = setup();
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item' });
    manager.destroy();

    manager.refresh({ cloneClass: 'x' });
    assert.equal(document.querySelectorAll('style').length, 0, 'стили не вернулись');
});

test('cancel() ожидающего drag сбрасывает таймер, повторный down работает', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 40 });

    mouse.down(items[0], 10, 10);
    manager.cancel();
    await wait(60);
    flushFrames();
    assert.equal(manager.getState().isDragging, false, 'отменённый drag не стартовал');

    // новый drag после отмены
    mouse.down(items[1], 10, 150);
    await wait(60);
    mouse.move(10, 250);
    flushFrames();
    assert.equal(manager.getState().isDragging, true, 'новый drag начался');
    assert.equal(manager.getState().itemId, 'b');

    manager.destroy();
});

test('cancel() отменяет уже запланированный кадр', async () => {
    const { root, items, document, window, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });
    const moves = [];
    root.addEventListener('dragMove', () => moves.push(1));

    // Считаем отмены кадров, чтобы убедиться, что кадр действительно был запланирован.
    // Модуль вызывает глобальный cancelAnimationFrame — подменяем его, а не window.
    let cancelled = 0;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.cancelAnimationFrame = (id) => { cancelled++; return originalCancel(id); };

    mouse.down(items[0], 10, 10);
    await wait(10);
    mouse.move(10, 180);   // первый move стартует drag (кадр не планируется)
    flushFrames();
    moves.length = 0;

    mouse.move(10, 200);   // второй move планирует кадр, который ещё не выполнен
    manager.cancel();

    globalThis.cancelAnimationFrame = originalCancel;
    flushFrames();

    assert.equal(cancelled, 1, 'запланированный кадр был отменён');
    assert.equal(moves.length, 0, 'отменённый кадр не выполнился');
    assert.equal(manager.getState().isDragging, false);

    manager.destroy();
});

test('движение внутри одной и той же цели не пересоздаёт индикатор', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    mouse.down(items[0], 10, 10);
    await wait(10);
    mouse.move(10, 110);          // верхняя половина 'b' -> before
    flushFrames();
    const ghost = root.querySelector('.item-ghost');
    assert.ok(ghost, 'индикатор создан');

    mouse.move(10, 130);          // та же зона 'b' -> before
    flushFrames();

    assert.equal(root.querySelector('.item-ghost'), ghost, 'узел индикатора переиспользован');
    assert.equal(root.querySelectorAll('.item-ghost').length, 1, 'дубликатов нет');

    manager.destroy();
});

test('debug включается через refresh на работающем инстансе', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5, debug: false });

    assert.equal(document.querySelector('.ds-debug-info'), null, 'debug выключен');

    manager.refresh({ debug: true });
    assert.equal(document.querySelectorAll('.ds-debug-info').length, 1, 'оверлей появился');
    assert.equal(document.querySelector('.ds-debug-cursor-level') !== null, true);

    // индикатор работает после включения
    mouse.down(items[0], 10, 10);
    await wait(10);
    mouse.move(10, 60);
    flushFrames();
    assert.match(document.querySelector('.ds-debug-cursor-level').style.top, /%$/);

    manager.destroy();
    assert.equal(document.querySelectorAll('style').length, 0, 'все стили освобождены');
});

test('индикатор восстанавливается, если потребитель удалил его из DOM', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    // id контейнера задаётся через data-container-id: у #root нет data-id
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    mouse.down(items[0], 10, 10);
    await wait(10);
    mouse.move(10, 180);
    flushFrames();

    const ghost = root.querySelector('.item-ghost');
    assert.ok(ghost);

    // потребитель перерисовал контейнер и выбросил индикатор вместе с содержимым
    ghost.remove();
    mouse.move(10, 130);
    flushFrames();

    const restored = root.querySelector('.item-ghost');
    assert.ok(restored, 'индикатор создан заново');
    assert.notEqual(restored, ghost, 'это новый узел');
    assert.equal(root.querySelectorAll('.item-ghost').length, 1, 'дубликатов нет');
    assert.equal(manager.getState().position, 'before', 'цель определена заново');
    assert.equal(manager.getState().toIndex, 0, 'индекс пересчитан');

    mouse.up(10, 130);
    flushFrames();
    assert.deepEqual([...root.children].map((el) => el.dataset.id), ['a', 'b', 'c'], 'порядок не изменился: цель совпала с исходной позицией');
    assert.equal(manager.getState().isDragging, false);

    manager.destroy();
});
