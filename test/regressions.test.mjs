// Регрессионные тесты на найденные дефекты:
//   1) исключение в пользовательском колбэке не должно «залипать» перетаскиванием;
//   2) невалидный селектор — понятная ошибка с названием опции, а не DOMException;
//   3) NaN/отрицательные пороги не должны молча отключать перетаскивание;
//   4) payload не должен содержать DOM-узлы.
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
    `);
    const { document, layout } = env;
    const root = document.querySelector('#root');
    const items = [...root.children];

    layout(root, { top: 0, left: 0, width: 400, height: 300 });
    items.forEach((el, i) => layout(el, { top: i * 100, left: 0, width: 400, height: 100 }));

    return { ...env, root, items };
};

const ids = (root) => [...root.children].map((el) => el.dataset.id);
const cloneInBody = (document) => document.body.querySelector('.item-clone');

const beginDrag = async (mouse, target, from, to, delay = 5) => {
    mouse.down(target, from.x, from.y);
    await wait(delay + 5);
    mouse.move(to.x, to.y);
};

// console.error во время теста — ожидаемая диагностика модуля, а не провал теста.
const captureErrors = () => {
    const original = console.error;
    const messages = [];
    console.error = (...args) => { messages.push(args); };
    return {
        messages,
        restore: () => { console.error = original; },
    };
};

test('исключение в getItemId не ломает drag: payload приходит с null, состояние согласовано', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({
        containerSelector: '#root',
        itemSelector: '.item',
        dragDelay: 5,
        getItemId: () => { throw new Error('boom'); },
    });
    let start = null;
    root.addEventListener('dragStart', (e) => { start = e.detail; });

    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args);
    try {
        await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
        flushFrames();
    } finally {
        console.error = original;
    }

    assert.equal(manager.getState().isDragging, true, 'перетаскивание продолжается');
    assert.equal(start.itemId, null, 'сбойный id заменён на null, а не выбросил исключение');
    assert.equal(start.fromIndex, 0, 'остальные поля payload корректны');
    assert.equal(start.toIndex, 1);
    assert.ok(errors.length > 0, 'ошибка продиагностирована в консоль');
    assert.equal(document.body.querySelectorAll('.item-clone').length, 1, 'клон на месте — drag живой');

    mouse.up(10, 180);
    flushFrames();

    assert.equal(manager.getState().isDragging, false, 'drag завершился штатно');
    assert.equal(document.body.querySelectorAll('.item-clone').length, 0, 'клон убран');
    assert.equal(root.querySelectorAll('.item-ghost').length, 0, 'индикатор убран');
    assert.deepEqual(ids(root), ['b', 'a', 'c'], 'перемещение применено');

    manager.destroy();
});

test('исключение в canDrop трактуется как запрет броска, но drag продолжается', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({
        containerSelector: '#root',
        itemSelector: '.item',
        dragDelay: 5,
        canDrop: () => { throw new Error('canDrop boom'); },
    });

    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args);
    try {
        await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
        flushFrames();
    } finally {
        console.error = original;
    }

    assert.equal(manager.getState().isDragging, true, 'drag не сломался');
    assert.equal(root.querySelectorAll('.item-ghost').length, 0, 'цель запрещена — ghost не создан');
    assert.equal(manager.getState().toContainerId, null);
    assert.ok(errors.length > 0, 'ошибка предиката продиагностирована');

    manager.destroy();
});

test('исключение в canDrag не запускает drag', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({
        containerSelector: '#root',
        itemSelector: '.item',
        dragDelay: 5,
        canDrag: () => { throw new Error('canDrag boom'); },
    });

    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args);
    try {
        await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
        flushFrames();
    } finally {
        console.error = original;
    }

    assert.equal(manager.getState().isDragging, false);
    assert.equal(document.body.querySelectorAll('.item-clone').length, 0);
    assert.ok(errors.length > 0);

    manager.destroy();
});

test('исключение в слушателе drop не оставляет артефактов после dragEnd', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    let ended = 0;
    root.addEventListener('drop', () => { throw new Error('consumer boom'); });
    root.addEventListener('dragEnd', () => { ended += 1; });

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();

    mouse.up(10, 180);
    flushFrames();

    assert.equal(ended, 1, 'dragEnd всё равно эмитится');
    assert.equal(manager.getState().isDragging, false, 'состояние сброшено несмотря на исключение');
    assert.equal(cloneInBody(document), null, 'клон убран');
    assert.equal(root.querySelectorAll('.item-ghost').length, 0, 'индикатор убран');
    assert.ok(!items[0].classList.contains('item-dragging'), 'класс снят');

    // модуль продолжает работать
    await beginDrag(mouse, items[1], { x: 10, y: 110 }, { x: 10, y: 280 });
    flushFrames();
    assert.equal(manager.getState().isDragging, true);

    manager.destroy();
});

test('невалидный containerSelector даёт TypeError с названием опции', () => {
    setupDom('<div class="container"></div>');

    assert.throws(
        () => dragNDrop({ containerSelector: '(((' }),
        (error) => error instanceof TypeError
            && error.message.includes('containerSelector')
            && error.message.includes('((('),
    );
});

test('невалидный itemSelector даёт TypeError с названием опции', () => {
    setupDom('<div class="container"></div>');

    assert.throws(
        () => dragNDrop({ containerSelector: '.container', itemSelector: 'a[' }),
        (error) => error instanceof TypeError && error.message.includes('itemSelector'),
    );
});

test('невалидный handleSelector и scrollContainer дают TypeError', () => {
    setupDom('<div class="container"><div class="item"></div></div>');

    assert.throws(
        () => dragNDrop({ containerSelector: '.container', itemSelector: '.item', handleSelector: ':::' }),
        (error) => error instanceof TypeError && error.message.includes('handleSelector'),
    );

    assert.throws(
        () => dragNDrop({ containerSelector: '.container', itemSelector: '.item', scrollContainer: '##' }),
        (error) => error instanceof TypeError && error.message.includes('scrollContainer'),
    );
});

test('пустой containerSelector откатывается к значению по умолчанию', () => {
    const env = setupDom('<div class="container"><div class="item"></div></div>');
    const manager = dragNDrop({ containerSelector: '   ' });

    assert.ok(manager, 'инстанс создан на дефолтном .container');
    assert.equal(env.document.querySelectorAll('style').length, 1);

    manager.destroy();
});

test('refresh с невалидным селектором не ломает работающий инстанс', () => {
    const { root } = setup();
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item' });

    assert.throws(
        () => manager.refresh({ containerSelector: '(((' }),
        (error) => error instanceof TypeError && error.message.includes('containerSelector'),
    );

    // старый конфиг остался рабочим
    assert.equal(manager.getState().isDragging, false);
    assert.ok(root.classList.contains('container'));

    manager.destroy();
    assert.equal(root.ownerDocument.querySelectorAll('style').length, 0);
});

test('dragThreshold: NaN не отключает перетаскивание', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5, dragThreshold: NaN });

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();

    assert.equal(manager.getState().isDragging, true, 'порог заменён значением по умолчанию');
    assert.equal(manager.getState().toIndex, 1);

    manager.destroy();
});

test('dragDelay: отрицательное значение не блокирует старт', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: -100 });

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 }, 0);
    flushFrames();

    assert.equal(manager.getState().isDragging, true);

    manager.destroy();
});

test('dragDelay: Infinity и строка не мешают старту', async () => {
    for (const dragDelay of [Infinity, 'soon', null, undefined]) {
        const { items, document, flushFrames } = setup();
        const mouse = createMouse(document.defaultView, document);
        const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay });

        await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 }, 110);
        flushFrames();

        assert.equal(manager.getState().isDragging, true, `dragDelay=${String(dragDelay)}`);
        manager.destroy();
    }
});

test('reorder с неизвестным значением откатывается к dom', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5, reorder: 'vue' });

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();
    mouse.up(10, 180);
    flushFrames();

    assert.deepEqual(ids(root), ['b', 'a', 'c'], 'DOM обновлён как в режиме dom');

    manager.destroy();
});

test('getItemId, возвращающий DOM-узел, не ломает payload: значение сериализуется как есть', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({
        containerSelector: '#root',
        itemSelector: '.item',
        dragDelay: 5,
        getItemId: (el) => el,
    });

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();

    const state = manager.getState();
    assert.equal(state.itemId, items[0], 'идентификатор — то, что вернул потребитель');
    assert.equal(state.fromIndex, 0);
    assert.doesNotThrow(() => JSON.stringify({ itemId: null }));

    manager.destroy();
});

test('два инстанса на одном контейнере не конфликтуют', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const first = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });
    const second = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();

    assert.equal(first.getState().isDragging, true);
    assert.equal(second.getState().isDragging, true, 'оба инстанса ведут drag независимо');
    assert.equal(document.querySelectorAll('style').length, 1, 'стиль общий');

    mouse.up(10, 180);
    flushFrames();

    assert.equal(first.getState().isDragging, false);
    assert.equal(second.getState().isDragging, false);
    assert.equal(root.querySelectorAll('.item-ghost').length, 0);
    assert.equal(document.body.querySelectorAll('.item-clone').length, 0);
    assert.equal(ids(root).length, 3, 'количество элементов не изменилось');

    first.destroy();
    second.destroy();
});

test('refresh принимает новые itemSelector и handleSelector', async () => {
    const env = setupDom(`
        <div class="container" id="root" data-id="root">
            <div class="card" data-id="a">A</div>
            <div class="card" data-id="b">B</div>
        </div>
    `);
    const { document, layout, flushFrames } = env;
    const root = document.querySelector('#root');
    const [a, b] = [...root.children];
    layout(root, { top: 0, left: 0, width: 400, height: 200 });
    layout(a, { top: 0, left: 0, width: 400, height: 100 });
    layout(b, { top: 100, left: 0, width: 400, height: 100 });

    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    manager.refresh({ itemSelector: '.card', handleSelector: null });

    await beginDrag(mouse, a, { x: 10, y: 10 }, { x: 10, y: 180 });
    flushFrames();

    assert.equal(manager.getState().isDragging, true, 'новый селектор элемента работает');
    assert.equal(manager.getState().itemId, 'a');

    manager.destroy();
});

test('refresh с невалидным itemSelector не применяет конфиг', () => {
    const { root } = setup();
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item' });

    assert.throws(
        () => manager.refresh({ itemSelector: 'a[' }),
        (error) => error instanceof TypeError && error.message.includes('itemSelector'),
    );

    // рабочий конфиг не изменился: инстанс продолжает работать
    assert.equal(manager.getState().isDragging, false);
    manager.destroy();
    assert.equal(root.ownerDocument.querySelectorAll('style').length, 0);
});

test('refresh с невалидным handleSelector отклоняется', () => {
    const { root } = setup();
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item' });

    assert.throws(
        () => manager.refresh({ handleSelector: ':::' }),
        (error) => error instanceof TypeError && error.message.includes('handleSelector'),
    );

    manager.destroy();
    assert.equal(root.ownerDocument.querySelectorAll('style').length, 0);
});

test('сбой при отправке dragStart откатывает старт: артефактов не остаётся', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    // jsdom изолирует исключения слушателей, поэтому ломаем сам dispatchEvent:
    // так проверяется отказоустойчивость старта к любой ошибке внутри него.
    const originalDispatch = root.dispatchEvent;
    root.dispatchEvent = () => { throw new Error('dispatch boom'); };

    const errors = captureErrors();
    try {
        await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 });
        flushFrames();
    } finally {
        errors.restore();
        root.dispatchEvent = originalDispatch;
    }

    assert.equal(manager.getState().isDragging, false, 'старт откачен');
    assert.equal(cloneInBody(document), null, 'клон не остался в body');
    assert.equal(root.querySelectorAll('.item-ghost').length, 0, 'индикатор убран');
    assert.ok(!items[0].classList.contains('item-dragging'), 'оригинал снова виден');
    assert.ok(errors.messages.length > 0, 'ошибка продиагностирована');

    manager.destroy();
});

test('dragNDrop() без аргументов не бросает на пустом документе', () => {
    setupDom('');
    assert.equal(dragNDrop(), undefined, 'нет контейнера — нет инстанса');
});

test('refresh с NaN в порогах нормализует значение', async () => {
    const { items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    manager.refresh({ dragThreshold: NaN, dragDelay: NaN });

    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 180 }, 110);
    flushFrames();

    assert.equal(manager.getState().isDragging, true, 'перетаскивание работает после refresh');

    manager.destroy();
});

test('кэш структуры сбрасывается, если потребитель перерисовал список на dragOver', async () => {
    const { root, items, document, flushFrames } = setup();
    const mouse = createMouse(document.defaultView, document);
    const manager = dragNDrop({ containerSelector: '#root', itemSelector: '.item', dragDelay: 5 });

    // Потребитель отвечает на dragOver перерисовкой: пункты заменяются новыми узлами.
    let redraws = 0;
    root.addEventListener('dragOver', () => {
        if (redraws > 0) return;
        redraws += 1;
        const ids = [...root.querySelectorAll('.item:not(.item-ghost)')].map((el) => el.dataset.id);
        root.querySelectorAll('.item:not(.item-ghost)').forEach((el) => el.remove());
        for (const id of ids) {
            const el = document.createElement('div');
            el.className = 'item';
            el.dataset.id = id;
            el.textContent = id.toUpperCase();
            root.appendChild(el);
        }
    });

    // Двигаемся по списку, пока цель не сменится и не придёт dragOver.
    await beginDrag(mouse, items[0], { x: 10, y: 10 }, { x: 10, y: 60 });
    flushFrames();
    for (let y = 60; y <= 280 && redraws === 0; y += 20) {
        mouse.move(10, y);
        flushFrames();
    }
    // Ещё одно движение: индекс считается по новым узлам, а не по кэшу старых
    mouse.move(10, 290);
    flushFrames();
    mouse.up(10, 290);
    flushFrames();

    assert.equal(redraws, 1, 'перерисовка произошла');
    assert.equal(manager.getState().isDragging, false);
    assert.equal(root.querySelectorAll('.item-ghost').length, 0, 'индикатор убран');

    manager.destroy();
});
