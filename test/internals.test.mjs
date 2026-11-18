// Юнит-тесты чистых функций. Каждая функция проверяется изолированно:
// смежные зависимости (DOM-запросы, matches, getBoundingClientRect, getItemId)
// передаются моками, поэтому падение теста указывает на одну конкретную функцию.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers.mjs';
import {
    DEBUG_STYLE_SIGNATURE,
    DEFAULTS,
    REORDER_MODES,
    SCROLLABLE_OVERFLOW,
    toFiniteNumber,
    normalizeOptions,
    assertSelectorSyntax,
    createStyleCss,
    createDebugCss,
    createStyleRegistry,
    createItemClassifier,
    createChildContainerResolver,
    collectItems,
    getItemIndex,
    resolveDropZone,
    getTargetContainer,
    resolveContainerInsertion,
    detachGhost,
    hasExceededThreshold,
    buildPayload,
    shouldEmitDragOver,
    isScrollableStyle,
    getScrollDelta,
    getCoordinates,
    createDragCloneCache,
    captureRects,
    visibleChildRange,
    computeFlipTransforms,
} from '../index.js';

// --- Моки -----------------------------------------------------------------

// Фейковый документ: только то, что нужно реестру стилей.
const createFakeDocument = () => {
    const head = {
        children: [],
        appendChild(el) {
            this.children.push(el);
            el.parentNode = this;
        },
    };

    return {
        head,
        createElement(tag) {
            return {
                tag,
                textContent: '',
                parentNode: null,
                remove() {
                    if (!this.parentNode) return;
                    const list = this.parentNode.children;
                    const index = list.indexOf(this);
                    if (index >= 0) list.splice(index, 1);
                    this.parentNode = null;
                },
            };
        },
    };
};

// Элемент-заглушка: только те свойства, которые читает конкретная функция.
const fakeEl = (name, { children = [], parent = null } = {}) => {
    const el = { name, children, parentElement: parent };
    for (const child of children) child.parentElement = el;
    return el;
};

const countingMatches = (predicate) => {
    const calls = [];
    const matches = (el, selector) => {
        calls.push([el, selector]);
        return predicate(el, selector);
    };
    return { matches, calls };
};

// --- Константы ------------------------------------------------------------

test('DEFAULTS: значения по умолчанию и заморозка', () => {
    assert.equal(DEFAULTS.containerSelector, '.container');
    assert.equal(DEFAULTS.itemSelector, '.item');
    assert.equal(DEFAULTS.ghostClass, 'item-ghost');
    assert.equal(DEFAULTS.draggingClass, 'item-dragging');
    assert.equal(DEFAULTS.cloneClass, 'item-clone');
    assert.equal(DEFAULTS.handleSelector, null);
    assert.equal(DEFAULTS.dragDelay, 100);
    assert.equal(DEFAULTS.dragThreshold, 5);
    assert.equal(DEFAULTS.scrollSpeed, 10);
    assert.equal(DEFAULTS.scrollThreshold, 50);
    assert.equal(DEFAULTS.debug, false);
    assert.equal(DEFAULTS.reorder, 'dom');
    assert.equal(DEFAULTS.disabled, false);
    assert.equal(DEFAULTS.canDrag, null);
    assert.equal(DEFAULTS.canDrop, null);
    assert.equal(DEFAULTS.animation, false);
    assert.equal(DEFAULTS.animationDuration, 200);
    assert.equal(DEFAULTS.scrollContainer, null);
    assert.equal(DEFAULTS.getItemId({ dataset: { id: 'x' } }), 'x');
    assert.equal(DEFAULTS.getItemId({}), null);
    assert.equal(DEFAULTS.getItemId(null), null);
    assert.equal(DEFAULTS.getContainerId({ dataset: { id: 'c' } }), 'c');
    assert.equal(DEFAULTS.getContainerId({ dataset: { containerId: 'k' } }), 'k');
    assert.equal(DEFAULTS.getContainerId({ dataset: {} }), null);

    assert.ok(Object.isFrozen(DEFAULTS), 'DEFAULTS защищён от изменений');
});

test('REORDER_MODES и SCROLLABLE_OVERFLOW содержат только поддерживаемые значения', () => {
    assert.deepEqual([...REORDER_MODES], ['dom', 'manual']);
    assert.ok(Object.isFrozen(REORDER_MODES));
    assert.deepEqual([...SCROLLABLE_OVERFLOW], ['auto', 'scroll', 'overlay']);
    assert.ok(Object.isFrozen(SCROLLABLE_OVERFLOW));
    assert.equal(DEBUG_STYLE_SIGNATURE, 'ds-debug');
});

// --- toFiniteNumber -------------------------------------------------------

test('toFiniteNumber: числа, NaN, Infinity и нечисловые значения', () => {
    const dataset = [
        [0, 7, 0],
        [-12, 7, -12],
        [3.5, 7, 3.5],
        [NaN, 7, 7],
        [Infinity, 7, 7],
        [-Infinity, 7, 7],
        ['5', 7, 7],
        ['abc', 7, 7],
        [null, 7, 7],
        [undefined, 7, 7],
        [{}, 7, 7],
        [true, 7, 7],
    ];

    for (const [value, fallback, expected] of dataset) {
        assert.equal(
            toFiniteNumber(value, fallback),
            expected,
            `toFiniteNumber(${String(value)}, ${fallback})`,
        );
    }
});

// --- normalizeOptions -----------------------------------------------------

test('normalizeOptions: пустые аргументы дают значения по умолчанию', () => {
    for (const input of [undefined, null, 0, 'string', [], true]) {
        const config = normalizeOptions(input);
        assert.equal(config.containerSelector, DEFAULTS.containerSelector);
        assert.equal(config.itemSelector, DEFAULTS.itemSelector);
        assert.equal(config.dragDelay, DEFAULTS.dragDelay);
        assert.equal(config.reorder, DEFAULTS.reorder);
        assert.equal(config.animation, DEFAULTS.animation);
        assert.equal(config.canDrag, null);
    }
});

test('normalizeOptions: NaN, Infinity и отрицательные числа заменяются безопасными', () => {
    const dataset = [
        [{ dragDelay: NaN }, 'dragDelay', DEFAULTS.dragDelay],
        [{ dragDelay: -100 }, 'dragDelay', 0],
        [{ dragDelay: Infinity }, 'dragDelay', DEFAULTS.dragDelay],
        [{ dragThreshold: NaN }, 'dragThreshold', DEFAULTS.dragThreshold],
        [{ dragThreshold: -1 }, 'dragThreshold', 0],
        [{ dragThreshold: 12 }, 'dragThreshold', 12],
        [{ scrollSpeed: NaN }, 'scrollSpeed', DEFAULTS.scrollSpeed],
        [{ scrollSpeed: -5 }, 'scrollSpeed', 0],
        [{ scrollThreshold: '50' }, 'scrollThreshold', DEFAULTS.scrollThreshold],
        [{ animationDuration: NaN }, 'animationDuration', DEFAULTS.animationDuration],
        [{ animationDuration: -10 }, 'animationDuration', 0],
    ];

    for (const [options, key, expected] of dataset) {
        assert.equal(normalizeOptions(options)[key], expected, `${key} из ${JSON.stringify(options)}`);
    }
});

test('normalizeOptions: строковые опции и селекторы', () => {
    const config = normalizeOptions({
        containerSelector: '#list',
        itemSelector: '.card',
        ghostClass: 'my-ghost',
        draggingClass: 'my-dragging',
        cloneClass: 'my-clone',
        handleSelector: '.handle',
    });

    assert.equal(config.containerSelector, '#list');
    assert.equal(config.itemSelector, '.card');
    assert.equal(config.ghostClass, 'my-ghost');
    assert.equal(config.draggingClass, 'my-dragging');
    assert.equal(config.cloneClass, 'my-clone');
    assert.equal(config.handleSelector, '.handle');

    // пустая строка и пробелы не должны становиться селектором
    const blank = normalizeOptions({
        containerSelector: '   ',
        itemSelector: '',
        ghostClass: '',
        draggingClass: '  ',
        cloneClass: 42,
        handleSelector: '   ',
    });

    assert.equal(blank.containerSelector, DEFAULTS.containerSelector);
    assert.equal(blank.itemSelector, DEFAULTS.itemSelector);
    assert.equal(blank.ghostClass, DEFAULTS.ghostClass);
    assert.equal(blank.draggingClass, DEFAULTS.draggingClass);
    assert.equal(blank.cloneClass, DEFAULTS.cloneClass);
    assert.equal(blank.handleSelector, null);
});

test('normalizeOptions: reorder и animation', () => {
    assert.equal(normalizeOptions({ reorder: 'manual' }).reorder, 'manual');
    assert.equal(normalizeOptions({ reorder: 'dom' }).reorder, 'dom');
    assert.equal(normalizeOptions({ reorder: 'vue' }).reorder, DEFAULTS.reorder);
    assert.equal(normalizeOptions({ reorder: null }).reorder, DEFAULTS.reorder);

    assert.equal(normalizeOptions({ animation: true }).animation, true);
    assert.equal(normalizeOptions({ animation: false }).animation, false);
    assert.equal(normalizeOptions({ animation: 0 }).animation, 0);
    assert.equal(normalizeOptions({ animation: 350 }).animation, 350);
    assert.equal(normalizeOptions({ animation: -5 }).animation, false);
    assert.equal(normalizeOptions({ animation: NaN }).animation, false);
    assert.equal(normalizeOptions({ animation: 'yes' }).animation, false);
});

test('normalizeOptions: функции и флаги', () => {
    const getItemId = (el) => el.id;
    const canDrag = () => false;
    const config = normalizeOptions({
        getItemId,
        canDrag,
        canDrop: 'not a function',
        getContainerId: 42,
        debug: 1,
        disabled: 'yes',
    });

    assert.equal(config.getItemId, getItemId);
    assert.equal(config.canDrag, canDrag);
    assert.equal(config.canDrop, null, 'не-функция не должна попасть в конфиг');
    assert.equal(config.getContainerId, DEFAULTS.getContainerId, 'не-функция заменяется дефолтом');
    assert.equal(config.debug, true);
    assert.equal(config.disabled, true);
    assert.equal(normalizeOptions({ debug: 0 }).debug, false);
    assert.equal(normalizeOptions({ disabled: '' }).disabled, false);
});

test('normalizeOptions: scrollContainer принимает селектор, элемент и null', () => {
    const element = fakeEl('scroll');

    assert.equal(normalizeOptions({ scrollContainer: '#list' }).scrollContainer, '#list');
    assert.equal(normalizeOptions({ scrollContainer: element }).scrollContainer, element);
    assert.equal(normalizeOptions({ scrollContainer: null }).scrollContainer, null);
    assert.equal(normalizeOptions({ scrollContainer: '   ' }).scrollContainer, '   ');
    assert.equal(normalizeOptions({}).scrollContainer, null);
});

test('normalizeOptions: исходный объект опций не мутируется', () => {
    const options = { dragDelay: NaN, reorder: 'vue' };
    const snapshot = { ...options };
    normalizeOptions(options);
    assert.deepEqual(options, snapshot);
});

// --- assertSelectorSyntax -------------------------------------------------

test('assertSelectorSyntax: валидный селектор возвращается и доходит до querySelector', () => {
    const calls = [];
    const source = {
        querySelector: (selector) => {
            calls.push(selector);
            return null;
        },
    };

    assert.equal(assertSelectorSyntax(source, '.item', 'itemSelector'), '.item');
    assert.deepEqual(calls, ['.item']);
});

test('assertSelectorSyntax: невалидный селектор даёт TypeError с названием опции', () => {
    const source = {
        querySelector: (selector) => {
            if (selector.includes('(')) throw new Error('SyntaxError');
            return null;
        },
    };

    assert.throws(
        () => assertSelectorSyntax(source, '(((', 'containerSelector'),
        (error) => error instanceof TypeError
            && error.message.includes('containerSelector')
            && error.message.includes('((('),
    );
});

test('assertSelectorSyntax: пустая строка и не-строка отклоняются без обращения к DOM', () => {
    const source = {
        querySelector: () => {
            throw new Error('не должен вызываться');
        },
    };

    for (const value of ['', '   ', null, undefined, 42, {}]) {
        assert.throws(
            () => assertSelectorSyntax(source, value, 'itemSelector'),
            (error) => error instanceof TypeError && /non-empty CSS selector/.test(error.message),
            `значение ${String(value)}`,
        );
    }
});

// --- CSS ------------------------------------------------------------------

test('createStyleCss подставляет переданные классы и не читает глобальный конфиг', () => {
    const css = createStyleCss({
        cloneClass: 'c-clone',
        draggingClass: 'c-drag',
        ghostClass: 'c-ghost',
    });

    assert.match(css, /\.c-clone \{/);
    assert.match(css, /\.c-drag \{/);
    assert.match(css, /\.c-ghost \{/);
    assert.doesNotMatch(css, /item-clone/);
    assert.match(css, /position: fixed/);
    assert.match(css, /display: none/);
    assert.equal(css.match(/pointer-events: none/g).length, 2, 'клон и индикатор не перехватывают курсор');
});

test('createDebugCss содержит селекторы оверлея и не зависит от аргументов', () => {
    const css = createDebugCss();
    assert.match(css, /\.ds-debug-info/);
    assert.match(css, /\.ds-debug-container/);
    assert.match(css, /\.ds-debug-cursor-level/);
    assert.equal(createDebugCss(), css, 'результат детерминирован');
});

// --- createStyleRegistry --------------------------------------------------

test('createStyleRegistry: одинаковый набор классов подключается один раз', () => {
    const doc = createFakeDocument();
    const registry = createStyleRegistry({ document: doc });

    const first = registry.acquire('sig', '.a{}');
    const second = registry.acquire('sig', '.a{}');

    assert.equal(doc.head.children.length, 1, 'один <style> на два потребителя');
    assert.equal(first.el, second.el);
    assert.equal(registry.size(), 1);
    assert.equal(first.el.tag, 'style');
    assert.equal(first.el.textContent, '.a{}');
});

test('createStyleRegistry: разные подписи дают разные <style>', () => {
    const doc = createFakeDocument();
    const registry = createStyleRegistry({ document: doc });

    registry.acquire('a', '.a{}');
    registry.acquire('b', '.b{}');

    assert.equal(doc.head.children.length, 2);
    assert.equal(registry.size(), 2);
});

test('createStyleRegistry: узел удаляется последним потребителем', () => {
    const doc = createFakeDocument();
    const registry = createStyleRegistry({ document: doc });

    const first = registry.acquire('sig', '.a{}');
    const second = registry.acquire('sig', '.a{}');

    registry.release(first);
    assert.equal(doc.head.children.length, 1, 'стиль жив, пока есть потребитель');

    registry.release(second);
    assert.equal(doc.head.children.length, 0, 'стиль удалён');
    assert.equal(registry.size(), 0, 'запись реестра очищена');
});

test('createStyleRegistry: повторное освобождение и null безопасны', () => {
    const doc = createFakeDocument();
    const registry = createStyleRegistry({ document: doc });

    registry.release(null);
    const entry = registry.acquire('sig', '.a{}');
    registry.release(entry);
    assert.doesNotThrow(() => registry.release(entry));
    assert.equal(doc.head.children.length, 0);
});

test('createStyleRegistry: запись из другого документа только удаляется', () => {
    const doc = createFakeDocument();
    const foreign = createFakeDocument();
    const registry = createStyleRegistry({ document: doc });
    const foreignRegistry = createStyleRegistry({ document: foreign });

    const entry = foreignRegistry.acquire('sig', '.a{}');
    registry.release(entry);

    assert.equal(foreign.head.children.length, 0, 'узел убран из своего документа');
    assert.equal(doc.head.children.length, 0, 'в текущий документ ничего не добавилось');
});

// --- createItemClassifier -------------------------------------------------

test('createItemClassifier: результат matches кэшируется на элемент', () => {
    const { matches, calls } = countingMatches((el) => el.kind === 'item');
    const isItem = createItemClassifier('.item', { matches });
    const a = { kind: 'item' };
    const b = { kind: 'other' };

    assert.equal(isItem(a), true);
    assert.equal(isItem(a), true);
    assert.equal(isItem(b), false);
    assert.equal(isItem(b), false);

    assert.equal(calls.length, 2, 'matches вызван один раз на элемент');
    assert.deepEqual(calls[0], [a, '.item'], 'селектор передаётся без изменений');
});

test('createItemClassifier: reset пересобирает кэш', () => {
    const { matches, calls } = countingMatches(() => true);
    const isItem = createItemClassifier('.item', { matches });
    const el = {};

    isItem(el);
    isItem.reset();
    isItem(el);

    assert.equal(calls.length, 2, 'после reset matches вызывается снова');
});

test('createItemClassifier: значения без matches не считаются элементами', () => {
    const isItem = createItemClassifier('.item');

    for (const value of [null, undefined, 0, '', 'text', {}, { matches: 'nope' }]) {
        assert.equal(isItem(value), false, `значение ${String(value)}`);
    }
});

test('createItemClassifier: по умолчанию использует el.matches', () => {
    const isItem = createItemClassifier('.item');
    assert.equal(isItem({ matches: (sel) => sel === '.item' }), true);
    assert.equal(isItem({ matches: () => false }), false);
});

// --- createChildContainerResolver ----------------------------------------

test('createChildContainerResolver: результат query кэшируется', () => {
    const calls = [];
    const query = (el, selector) => {
        calls.push([el, selector]);
        return el.child ?? null;
    };
    const resolve = createChildContainerResolver('.container', { query });
    const item = { child: { name: 'child' } };

    assert.equal(resolve(item), item.child);
    assert.equal(resolve(item), item.child);
    assert.equal(calls.length, 1, 'обход поддерева выполнен один раз');
    assert.deepEqual(calls[0], [item, '.container']);
});

test('createChildContainerResolver: отсутствие вложенного контейнера тоже кэшируется', () => {
    const calls = [];
    const query = (el) => {
        calls.push(el);
        return null;
    };
    const resolve = createChildContainerResolver('.container', { query });
    const item = {};

    assert.equal(resolve(item), null);
    assert.equal(resolve(item), null);
    assert.equal(calls.length, 1, 'null тоже запоминается');
});

test('createChildContainerResolver: reset и пустые значения', () => {
    const calls = [];
    const query = (el) => {
        calls.push(el);
        return null;
    };
    const resolve = createChildContainerResolver('.container', { query });
    const item = {};

    assert.equal(resolve(null), null);
    assert.equal(resolve(undefined), null);
    assert.equal(calls.length, 0, 'для пустого элемента query не вызывается');

    resolve(item);
    resolve.reset();
    resolve(item);
    assert.equal(calls.length, 2, 'после reset запрос повторён');
});

// --- getItemIndex / collectItems -------------------------------------------

const itemFlags = (flags) => {
    const isItem = (el) => flags[el.name] === true;
    return isItem;
};

test('getItemIndex: индекс среди item-детей, не-item дети игнорируются', () => {
    const a = fakeEl('a');
    const gap = fakeEl('gap');
    const b = fakeEl('b');
    const c = fakeEl('c');
    const children = [a, gap, b, c];
    const isItem = itemFlags({ a: true, b: true, c: true });

    assert.equal(getItemIndex(children, isItem, a), 0);
    assert.equal(getItemIndex(children, isItem, b), 1);
    assert.equal(getItemIndex(children, isItem, c), 2);
    assert.equal(getItemIndex(children, isItem, gap), -1, 'не-item не имеет индекса');
});

test('getItemIndex: exclude исключает элемент из нумерации', () => {
    const a = fakeEl('a');
    const b = fakeEl('b');
    const c = fakeEl('c');
    const children = [a, b, c];
    const isItem = () => true;

    assert.equal(getItemIndex(children, isItem, c), 2);
    assert.equal(getItemIndex(children, isItem, c, { exclude: a }), 1);
    assert.equal(getItemIndex(children, isItem, b, { exclude: b }), -1, 'исключённый элемент не найден');
});

test('getItemIndex: пустой список, отсутствующая цель и цель вне списка', () => {
    const isItem = () => true;
    assert.equal(getItemIndex([], isItem, fakeEl('x')), -1);
    assert.equal(getItemIndex([fakeEl('a')], isItem, fakeEl('zzz')), -1);
    assert.equal(getItemIndex([], isItem, null), -1);
});

test('collectItems: порядок и индексы совпадают с getItemIndex', () => {
    const els = ['a', 'gap', 'b', 'c'].map((name) => fakeEl(name));
    const isItem = itemFlags({ a: true, b: true, c: true });

    const { all, index } = collectItems(els, isItem);

    assert.deepEqual(all.map((el) => el.name), ['a', 'b', 'c'], 'не-item дети отброшены');
    for (const el of all) {
        assert.equal(index.get(el), getItemIndex(els, isItem, el), `индекс ${el.name} совпадает`);
    }
    assert.equal(index.size, 3);
});

test('collectItems: exclude не попадает ни в порядок, ни в индексы', () => {
    const els = ['a', 'b', 'c'].map((name) => fakeEl(name));
    const isItem = () => true;

    const { all, index } = collectItems(els, isItem, { exclude: els[1] });

    assert.deepEqual(all.map((el) => el.name), ['a', 'c']);
    assert.equal(index.has(els[1]), false, 'исключённый элемент не имеет индекса');
    assert.equal(index.get(els[2]), 1, 'нумерация идёт без исключённого');
    assert.equal(getItemIndex(els, isItem, els[2], { exclude: els[1] }), 1, 'совпадает с getItemIndex');
});

test('collectItems: пустой список даёт пустые порядок и индексы', () => {
    const { all, index } = collectItems([], () => true);
    assert.deepEqual(all, []);
    assert.equal(index.size, 0);
});

// --- resolveDropZone ------------------------------------------------------

test('resolveDropZone: плоский элемент делится на две зоны с границей 51%', () => {
    const dataset = [
        [0, 'before'],
        [50, 'before'],
        [50.9, 'before'],
        [51, 'after'],
        [99, 'after'],
        [100, 'after'],
    ];

    for (const [innerY, expected] of dataset) {
        assert.equal(
            resolveDropZone({ innerY, height: 100, hasChildContainer: false }),
            expected,
            `innerY=${innerY}`,
        );
    }
});

test('resolveDropZone: элемент с вложенным списком делится на три зоны', () => {
    const height = 300;
    const dataset = [
        [0, 'before'],
        [99.9, 'before'],
        [100, 'in'],
        [150, 'in'],
        [199.9, 'in'],
        [200, 'in'],
        [200.1, 'after'],
        [299, 'after'],
        [300, 'after'],
    ];

    for (const [innerY, expected] of dataset) {
        assert.equal(
            resolveDropZone({ innerY, height, hasChildContainer: true }),
            expected,
            `innerY=${innerY}`,
        );
    }
});

test('resolveDropZone: нулевая высота не бросает и относит к верхней зоне', () => {
    assert.equal(resolveDropZone({ innerY: 0, height: 0, hasChildContainer: false }), 'before');
    assert.equal(resolveDropZone({ innerY: 0, height: 0, hasChildContainer: true }), 'before');
});

// --- getTargetContainer ---------------------------------------------------

test('getTargetContainer: in — сам элемент, before/after — его родитель', () => {
    const parent = fakeEl('parent');
    const reference = fakeEl('ref', { parent });

    assert.equal(getTargetContainer(reference, 'in'), reference);
    assert.equal(getTargetContainer(reference, 'before'), parent);
    assert.equal(getTargetContainer(reference, 'after'), parent);
    assert.equal(getTargetContainer(reference, null), parent);
});

// --- resolveContainerInsertion --------------------------------------------

test('resolveContainerInsertion: промежуток между пунктами — вставка перед следующим', () => {
    // Пункты 0..100 и 200..300, между ними промежуток 100..200.
    const items = [fakeEl('a'), fakeEl('b'), fakeEl('c')];
    const rects = { a: 0, b: 200, c: 400 };
    const getRect = (el) => ({ top: rects[el.name], bottom: rects[el.name] + 100 });

    assert.deepEqual(
        resolveContainerInsertion({ y: 150, items, getRect }),
        { reference: items[1], position: 'before' },
        'промежуток между a и b — перед b',
    );
    assert.deepEqual(
        resolveContainerInsertion({ y: 350, items, getRect }),
        { reference: items[2], position: 'before' },
        'промежуток между b и c — перед c',
    );
});

test('resolveContainerInsertion: выше первого пункта — перед ним', () => {
    const items = [fakeEl('a'), fakeEl('b')];
    const getRect = (el) => ({ top: el.name === 'a' ? 100 : 300 });

    assert.deepEqual(
        resolveContainerInsertion({ y: 10, items, getRect }),
        { reference: items[0], position: 'before' },
    );
});

test('resolveContainerInsertion: ниже последнего пункта — null (работает обычное «внутрь»)', () => {
    const items = [fakeEl('a'), fakeEl('b')];
    const getRect = (el) => ({ top: el.name === 'a' ? 0 : 200 });

    assert.equal(resolveContainerInsertion({ y: 500, items, getRect }), null);
    assert.equal(resolveContainerInsertion({ y: 0, items: [], getRect }), null);
});

// --- detachGhost ----------------------------------------------------------

test('detachGhost: вынимает индикатор из DOM и возвращает на прежнее место', () => {
    const env = setupDom(`
        <div class="container" id="root">
            <div class="item" data-id="a"></div>
            <div class="item item-ghost" data-id="ghost"></div>
            <div class="item" data-id="b"></div>
        </div>
    `);
    const { document } = env;
    const root = document.querySelector('#root');
    const ghost = document.querySelector('.item-ghost');

    const detach = detachGhost(ghost);

    assert.equal(detach.detached, true);
    assert.equal(detach.parent, root);
    assert.equal(ghost.parentNode, null, 'индикатор вынут из DOM');
    assert.equal(root.children.length, 2, 'соседи не видят индикатора');

    detach.restore();

    assert.equal(ghost.parentNode, root);
    assert.deepEqual([...root.children].map((el) => el.dataset.id), ['a', 'ghost', 'b'], 'место восстановлено');
});

test('detachGhost: не переносит индикатор, если measure() уже вставил его в новое место', () => {
    const env = setupDom(`
        <div class="container" id="root">
            <div class="item" data-id="a"></div>
            <div class="item item-ghost" data-id="ghost"></div>
        </div>
        <div class="container" id="other"></div>
    `);
    const { document } = env;
    const root = document.querySelector('#root');
    const other = document.querySelector('#other');
    const ghost = document.querySelector('.item-ghost');

    const detach = detachGhost(ghost);
    other.appendChild(ghost); // так делает createGhostElement, когда цель сменилась
    detach.restore();

    assert.equal(ghost.parentNode, other, 'индикатор остался в новом контейнере');
    assert.equal(root.children.length, 1, 'в старом контейнере дубля нет');
});

test('detachGhost: без родителя ничего не делает', () => {
    const detach = detachGhost(null);
    assert.equal(detach.detached, false);
    assert.doesNotThrow(() => detach.restore());

    const orphan = { parentNode: null };
    assert.equal(detachGhost(orphan).detached, false);
});

test('detachGhost: если сосед исчез, индикатор возвращается в конец контейнера', () => {
    const env = setupDom(`
        <div class="container" id="root">
            <div class="item" data-id="a"></div>
            <div class="item item-ghost" data-id="ghost"></div>
            <div class="item" data-id="b"></div>
        </div>
    `);
    const { document } = env;
    const root = document.querySelector('#root');
    const ghost = document.querySelector('.item-ghost');

    const detach = detachGhost(ghost);
    // Пока шёл замер, потребитель перерисовал контейнер: сосед-элемент и текстовые
    // узлы после индикатора исчезли, вернуть его «перед b» уже нельзя.
    for (const node of [...root.childNodes]) {
        if (node !== root.firstElementChild) node.remove();
    }
    detach.restore();

    assert.equal(ghost.parentNode, root);
    assert.deepEqual([...root.children].map((el) => el.dataset.id), ['a', 'ghost']);
});

// --- hasExceededThreshold -------------------------------------------------
test('hasExceededThreshold: сравнение с порогом включительно', () => {
    const dataset = [
        [{ x: 0, y: 0 }, false],
        [{ x: 4.9, y: 0 }, false],
        [{ x: 5, y: 0 }, true],
        [{ x: 0, y: 5 }, true],
        [{ x: -5, y: 0 }, true],
        [{ x: 3, y: 4 }, true],
        [{ x: 10, y: 10 }, true],
    ];

    for (const [point, expected] of dataset) {
        assert.equal(
            hasExceededThreshold({ ...point, startX: 0, startY: 0, threshold: 5 }),
            expected,
            `точка ${point.x},${point.y}`,
        );
    }
});

test('hasExceededThreshold: смещение считается от заданной стартовой точки', () => {
    assert.equal(hasExceededThreshold({ x: 110, y: 100, startX: 100, startY: 100, threshold: 5 }), true);
    assert.equal(hasExceededThreshold({ x: 102, y: 102, startX: 100, startY: 100, threshold: 5 }), false);
    assert.equal(hasExceededThreshold({ x: 0, y: 0, startX: 0, startY: 0, threshold: 0 }), true,
        'нулевой порог пройден сразу');
});

// --- buildPayload ---------------------------------------------------------

test('buildPayload: все поля берутся из моков и аргументов', () => {
    const itemCalls = [];
    const containerCalls = [];
    const dragged = fakeEl('dragged');
    const from = fakeEl('from');
    const to = fakeEl('to');

    const payload = buildPayload({
        getItemId: (el) => {
            itemCalls.push(el);
            return 'item-1';
        },
        getContainerId: (el) => {
            containerCalls.push(el);
            return el.name;
        },
        draggedItem: dragged,
        fromContainer: from,
        fromIndex: 2,
        toContainer: to,
        toIndex: 0,
        position: 'before',
    });

    assert.deepEqual(payload, {
        itemId: 'item-1',
        fromContainerId: 'from',
        fromIndex: 2,
        toContainerId: 'to',
        toIndex: 0,
        position: 'before',
    });
    assert.deepEqual(itemCalls, [dragged]);
    assert.deepEqual(containerCalls, [from, to]);
});

test('buildPayload: без целевого контейнера toContainerId равен null', () => {
    const payload = buildPayload({
        getItemId: () => 'x',
        getContainerId: () => 'never',
        draggedItem: fakeEl('d'),
        fromContainer: fakeEl('f'),
        fromIndex: 0,
        toContainer: null,
        toIndex: null,
        position: null,
    });

    assert.equal(payload.toContainerId, null);
    assert.equal(payload.toIndex, null);
    assert.equal(payload.position, null);
});

test('buildPayload: payload сериализуем и не содержит DOM-узлов', () => {
    const payload = buildPayload({
        getItemId: () => 'id',
        getContainerId: () => 'cid',
        draggedItem: fakeEl('d'),
        fromContainer: fakeEl('f'),
        fromIndex: 1,
        toContainer: null,
        toIndex: null,
        position: null,
    });

    assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload, 'payload полностью сериализуем');
    assert.equal(typeof payload.itemId, 'string');
    assert.equal(typeof payload.fromContainerId, 'string');
});

// --- shouldEmitDragOver ---------------------------------------------------

test('shouldEmitDragOver: реагирует на любой изменившийся компонент цели', () => {
    const base = { toContainer: 'a', toIndex: 1, position: 'before' };

    assert.equal(shouldEmitDragOver(base, { ...base }), false, 'идентичная цель');
    assert.equal(shouldEmitDragOver(base, { ...base, toContainer: 'b' }), true);
    assert.equal(shouldEmitDragOver(base, { ...base, toIndex: 2 }), true);
    assert.equal(shouldEmitDragOver(base, { ...base, position: 'after' }), true);
    assert.equal(
        shouldEmitDragOver({ toContainer: null, toIndex: null, position: null }, base),
        true,
        'появление цели после её отсутствия',
    );
});

// --- isScrollableStyle ----------------------------------------------------

test('isScrollableStyle: нужен scrollable overflow и реальное переполнение', () => {
    const dataset = [
        [{ overflowY: 'auto', scrollHeight: 200, clientHeight: 100 }, true],
        [{ overflowY: 'scroll', scrollHeight: 200, clientHeight: 100 }, true],
        [{ overflowY: 'overlay', scrollHeight: 200, clientHeight: 100 }, true],
        [{ overflowY: 'hidden', scrollHeight: 200, clientHeight: 100 }, false],
        [{ overflowY: 'visible', scrollHeight: 200, clientHeight: 100 }, false],
        [{ overflowY: 'auto', scrollHeight: 100, clientHeight: 100 }, false],
        [{ overflowY: 'auto', scrollHeight: 101, clientHeight: 100 }, false],
        [{ overflowY: 'auto', scrollHeight: 102, clientHeight: 100 }, true],
        [{ overflowY: 'auto', scrollHeight: 50, clientHeight: 100 }, false],
    ];

    for (const [style, expected] of dataset) {
        assert.equal(
            isScrollableStyle(style),
            expected,
            `${style.overflowY}: ${style.scrollHeight}/${style.clientHeight}`,
        );
    }
});

// --- getScrollDelta -------------------------------------------------------

test('getScrollDelta: верхняя и нижняя зоны дают противоположные скорости', () => {
    const dataset = [
        [{ y: 0 }, -10],
        [{ y: 49 }, -10],
        [{ y: 50 }, 0],
        [{ y: 150 }, 0],
        [{ y: 250 }, 0],
        [{ y: 251 }, 10],
        [{ y: 300 }, 10],
    ];

    for (const [point, expected] of dataset) {
        assert.equal(
            getScrollDelta({ ...point, top: 0, bottom: 300, threshold: 50, speed: 10 }),
            expected,
            `y=${point.y}`,
        );
    }
});

test('getScrollDelta: скорость и порог параметризованы, скорость 0 отключает скролл', () => {
    assert.equal(getScrollDelta({ y: 5, top: 0, bottom: 300, threshold: 20, speed: 25 }), -25);
    assert.equal(getScrollDelta({ y: 295, top: 0, bottom: 300, threshold: 20, speed: 25 }), 25);
    assert.equal(getScrollDelta({ y: 5, top: 0, bottom: 300, threshold: 20, speed: 0 }), 0);
    assert.equal(getScrollDelta({ y: 150, top: 0, bottom: 300, threshold: 20, speed: 25 }), 0);
});

test('getScrollDelta: контейнер со смещением (top != 0)', () => {
    assert.equal(getScrollDelta({ y: 310, top: 300, bottom: 600, threshold: 50, speed: 8 }), -8);
    assert.equal(getScrollDelta({ y: 590, top: 300, bottom: 600, threshold: 50, speed: 8 }), 8);
    assert.equal(getScrollDelta({ y: 450, top: 300, bottom: 600, threshold: 50, speed: 8 }), 0);
});

// --- getCoordinates -------------------------------------------------------

test('getCoordinates: мышь читает clientX/clientY', () => {
    assert.deepEqual(
        getCoordinates({ type: 'mousemove', clientX: 12, clientY: 34 }),
        { x: 12, y: 34 },
    );
    assert.deepEqual(getCoordinates({ type: 'mousedown', clientX: -5, clientY: 0 }), { x: -5, y: 0 });
});

test('getCoordinates: касание читает первый touch', () => {
    assert.deepEqual(
        getCoordinates({
            type: 'touchmove',
            touches: [{ clientX: 7, clientY: 8 }, { clientX: 100, clientY: 100 }],
        }),
        { x: 7, y: 8 },
    );
});

test('getCoordinates: touchend без touches берёт changedTouches', () => {
    assert.deepEqual(
        getCoordinates({
            type: 'touchend',
            touches: [],
            changedTouches: [{ clientX: 21, clientY: 22 }],
        }),
        { x: 21, y: 22 },
    );
});

test('getCoordinates: отсутствующие данные не бросают', () => {
    assert.deepEqual(getCoordinates(undefined), { x: 0, y: 0 });
    assert.deepEqual(getCoordinates(null), { x: 0, y: 0 });
    assert.deepEqual(getCoordinates({}), { x: 0, y: 0 });
    assert.deepEqual(getCoordinates({ type: 'touchstart' }), { x: 0, y: 0 });
    assert.deepEqual(getCoordinates({ type: 'touchstart', touches: [] }), { x: 0, y: 0 });
    assert.deepEqual(getCoordinates({ type: 'mousemove' }), { x: 0, y: 0 });
});

// --- createDragCloneCache -------------------------------------------------

test('createDragCloneCache: клон создаётся один раз и очищается от класса', () => {
    const cloned = [];
    const removed = [];
    const item = fakeEl('item');
    const cache = createDragCloneCache({
        cloneNode: (el) => {
            cloned.push(el);
            return { copyOf: el.name };
        },
        removeClass: (copy) => removed.push(copy),
    });

    const first = cache.get(item);
    const second = cache.get(item);

    assert.equal(first, second, 'повторный вызов возвращает тот же клон');
    assert.equal(cloned.length, 1, 'cloneNode вызван один раз');
    assert.equal(removed.length, 1, 'класс снят один раз');
    assert.deepEqual(removed[0], first);
});

test('createDragCloneCache: reset сбрасывает клон', () => {
    let counter = 0;
    const cache = createDragCloneCache({
        cloneNode: () => ({ id: ++counter }),
        removeClass: () => {},
    });
    const item = fakeEl('item');

    const first = cache.get(item);
    cache.reset();
    const second = cache.get(item);

    assert.notEqual(first, second);
    assert.equal(counter, 2);
});

// --- captureRects ---------------------------------------------------------

test('captureRects: только прямые item-дети, без перетаскиваемого элемента', () => {
    const dragged = fakeEl('dragged');
    const a = fakeEl('a');
    const gap = fakeEl('gap');
    const b = fakeEl('b');
    const container = fakeEl('container', { children: [a, dragged, gap, b] });
    const other = fakeEl('other', { children: [fakeEl('c')] });

    const measured = [];
    const rects = captureRects({
        containers: [container, other],
        isItem: (el) => el.name !== 'gap',
        exclude: dragged,
        getRect: (el) => {
            measured.push(el.name);
            return { top: el.name.charCodeAt(0), left: 0 };
        },
    });

    assert.deepEqual([...rects.keys()].map((el) => el.name), ['a', 'b', 'c']);
    assert.deepEqual(measured, ['a', 'b', 'c'], 'getRect не вызывается для не-item и перетаскиваемого');
    assert.deepEqual(rects.get(a), { top: 'a'.charCodeAt(0), left: 0 });
});

test('captureRects: пустые контейнеры пропускаются', () => {
    const rects = captureRects({
        containers: [null, undefined, fakeEl('empty')],
        isItem: () => true,
        getRect: () => {
            throw new Error('не должно вызываться');
        },
    });

    assert.equal(rects.size, 0);
});

test('captureRects: без exclude все item-дети попадают в снимок', () => {
    const a = fakeEl('a');
    const b = fakeEl('b');
    const calls = [];
    const rects = captureRects({
        containers: [fakeEl('c', { children: [a, b] })],
        isItem: () => true,
        getRect: (el) => {
            calls.push(el.name);
            return { top: calls.length, left: 0 };
        },
    });

    assert.equal(rects.size, 2);
    assert.deepEqual(calls, ['a', 'b'], 'замер выполнен для каждого ребёнка');
    assert.deepEqual(rects.get(a), { top: 1, left: 0 });
    assert.deepEqual(rects.get(b), { top: 2, left: 0 });
});

// --- visibleChildRange ----------------------------------------------------

// Ряд из n строк высотой 100, начиная с 0.
const rows = (n) => Array.from({ length: n }, (_, i) => ({ name: `r${i}` }));
const rowRect = (el) => {
    const top = Number(el.name.slice(1)) * 100;
    return { top, bottom: top + 100 };
};

test('visibleChildRange: окно отсекает строки выше и ниже', () => {
    const children = rows(100);
    let calls = 0;
    const getRect = (el) => {
        calls += 1;
        return rowRect(el);
    };

    const { start, end } = visibleChildRange({
        children, getRect, windowTop: 2000, windowBottom: 2500,
    });

    assert.equal(start, 20, 'первая видимая строка — та, что заканчивается ниже верха окна');
    assert.equal(end, 24, 'последняя видимая строка — та, что начинается выше низа окна');
    assert.ok(calls <= 16, `замеров: ${calls}, ожидалось не больше 16 (2*log2(100))`);
});

test('visibleChildRange: окно выше и ниже списка даёт пустой диапазон и весь список', () => {
    const children = rows(10);

    const below = visibleChildRange({
        children, getRect: rowRect, windowTop: 5000, windowBottom: 6000,
    });
    assert.equal(below.end, -1, 'всё выше окна — пустой диапазон');

    const around = visibleChildRange({
        children, getRect: rowRect, windowTop: -1000, windowBottom: 5000,
    });
    assert.deepEqual(around, { start: 0, end: 9 }, 'всё в окне — весь диапазон');
});

test('visibleChildRange: пустой список и вырожденное окно', () => {
    assert.deepEqual(
        visibleChildRange({ children: [], getRect: rowRect, windowTop: 0, windowBottom: 100 }),
        { start: 0, end: -1 },
    );

    // Окно нулевой высоты — отбор не имеет смысла, возвращается весь список.
    assert.deepEqual(
        visibleChildRange({ children: rows(3), getRect: rowRect, windowTop: 100, windowBottom: 100 }),
        { start: 0, end: 2 },
    );
});

test('visibleChildRange: немонотонный layout (сетка в колонках) даёт весь диапазон', () => {
    // Два столбца: r0=0, r1=0 (второй столбец), r2=100, r3=100.
    const tops = [0, 0, 100, 100];
    const children = rows(4);
    const getRect = (el) => {
        const top = tops[Number(el.name.slice(1))];
        return { top, bottom: top + 100 };
    };

    // Поиск по бинарному дереву нашёл бы границы, но соседи за ними видимы —
    // в этом случае возвращается весь список, а не обрезанный диапазон.
    const range = visibleChildRange({
        children, getRect, windowTop: 0, windowBottom: 200,
    });

    assert.deepEqual(range, { start: 0, end: 3 });
});

// --- computeFlipTransforms ------------------------------------------------

test('computeFlipTransforms: смещение инвертируется по знаку', () => {
    const down = { name: 'down' };
    const up = { name: 'up' };
    const still = { name: 'still' };

    const rects = new Map([
        [down, { top: 0, left: 0 }],
        [up, { top: 100, left: 0 }],
        [still, { top: 50, left: 0 }],
    ]);

    const last = new Map([
        [down, { top: 100, left: 0 }],
        [up, { top: 0, left: 0 }],
        [still, { top: 50, left: 0 }],
    ]);

    const moved = computeFlipTransforms({
        rects,
        getRect: (el) => last.get(el),
    });

    assert.deepEqual(moved, [
        { el: down, dx: 0, dy: -100 },
        { el: up, dx: 0, dy: 100 },
    ]);
});

test('computeFlipTransforms: смещение меньше 1px игнорируется', () => {
    const el = { name: 'el' };
    const moved = computeFlipTransforms({
        rects: new Map([[el, { top: 0, left: 0 }]]),
        getRect: () => ({ top: 0.5, left: -0.9 }),
    });

    assert.deepEqual(moved, []);
});

test('computeFlipTransforms: отключённые элементы и горизонтальный сдвиг', () => {
    const removed = { name: 'removed' };
    const shifted = { name: 'shifted' };

    const moved = computeFlipTransforms({
        rects: new Map([
            [removed, { top: 0, left: 0 }],
            [shifted, { top: 0, left: 0 }],
        ]),
        getRect: (el) => (el === removed ? { top: 100, left: 0 } : { top: 0, left: 40 }),
        isConnected: (el) => el !== removed,
    });

    assert.deepEqual(moved, [{ el: shifted, dx: -40, dy: 0 }]);
});

test('computeFlipTransforms: пустая карта даёт пустой список', () => {
    assert.deepEqual(
        computeFlipTransforms({ rects: new Map(), getRect: () => ({ top: 0, left: 0 }) }),
        [],
    );
    assert.deepEqual(
        computeFlipTransforms({ rects: null, getRect: () => ({ top: 0, left: 0 }) }),
        [],
    );
});
