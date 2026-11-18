// Библиотека намеренно живёт в одном файле: подключение одним <script type="module">
// не требует ни сборки, ни разрешения импортов в браузере.
// Чистые функции ниже экспортируются, чтобы их можно было покрыть юнит-тестами
// по отдельности — они не читают состояние модуля и не обращаются к DOM напрямую.

export const DEBUG_STYLE_SIGNATURE = 'ds-debug';

export const DEFAULTS = Object.freeze({
    containerSelector: '.container',
    itemSelector: '.item',
    ghostClass: 'item-ghost',
    draggingClass: 'item-dragging',
    cloneClass: 'item-clone',
    handleSelector: null,
    dragDelay: 100,
    dragThreshold: 5,
    scrollSpeed: 10,
    scrollThreshold: 50,
    debug: false,
    reorder: 'dom',
    getItemId: (el) => el?.dataset?.id ?? null,
    getContainerId: (el) => el?.dataset?.id ?? el?.dataset?.containerId ?? null,
    disabled: false,
    canDrag: null,
    canDrop: null,
    animation: false,
    animationDuration: 200,
    scrollContainer: null,
});

export const REORDER_MODES = Object.freeze(['dom', 'manual']);

export const SCROLLABLE_OVERFLOW = Object.freeze(['auto', 'scroll', 'overlay']);

// Запас вокруг окна при отборе элементов для FLIP: анимируем чуть больше,
// чем видно, чтобы при прокрутке на кадр не появлялись «прыгнувшие» строки.
export const VIEWPORT_MARGIN = 200;

// Нечисловое значение заменяется запасным: NaN в пороге делает сравнение
// всегда ложным, и перетаскивание не начнётся никогда — без единой ошибки.
export const toFiniteNumber = (value, fallback) =>
    (Number.isFinite(value) ? value : fallback);

const toNonNegativeNumber = (value, fallback) =>
    Math.max(0, toFiniteNumber(value, fallback));

const toNonEmptyString = (value, fallback) =>
    (typeof value === 'string' && value.trim() ? value : fallback);

const toOptionalFunction = (value, fallback = null) =>
    (typeof value === 'function' ? value : fallback);

const toOptionalSelector = (value) =>
    (typeof value === 'string' && value.trim() ? value : null);

const toAnimation = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : false;
    return value === true;
};

// Приводит пользовательские опции к предсказуемому виду.
// Невалидные значения не бросают исключение: они заменяются значениями по умолчанию,
// чтобы одна опечатка в конфиге не ломала перетаскивание целиком.
export const normalizeOptions = (options) => {
    const source = options && typeof options === 'object' ? options : {};
    const merged = { ...DEFAULTS, ...source };

    return {
        containerSelector: toNonEmptyString(merged.containerSelector, DEFAULTS.containerSelector),
        itemSelector: toNonEmptyString(merged.itemSelector, DEFAULTS.itemSelector),
        ghostClass: toNonEmptyString(merged.ghostClass, DEFAULTS.ghostClass),
        draggingClass: toNonEmptyString(merged.draggingClass, DEFAULTS.draggingClass),
        cloneClass: toNonEmptyString(merged.cloneClass, DEFAULTS.cloneClass),
        handleSelector: toOptionalSelector(merged.handleSelector),
        dragDelay: toNonNegativeNumber(merged.dragDelay, DEFAULTS.dragDelay),
        dragThreshold: toNonNegativeNumber(merged.dragThreshold, DEFAULTS.dragThreshold),
        scrollSpeed: toNonNegativeNumber(merged.scrollSpeed, DEFAULTS.scrollSpeed),
        scrollThreshold: toNonNegativeNumber(merged.scrollThreshold, DEFAULTS.scrollThreshold),
        debug: Boolean(merged.debug),
        reorder: REORDER_MODES.includes(merged.reorder) ? merged.reorder : DEFAULTS.reorder,
        getItemId: toOptionalFunction(merged.getItemId, DEFAULTS.getItemId),
        getContainerId: toOptionalFunction(merged.getContainerId, DEFAULTS.getContainerId),
        disabled: Boolean(merged.disabled),
        canDrag: toOptionalFunction(merged.canDrag),
        canDrop: toOptionalFunction(merged.canDrop),
        animation: toAnimation(merged.animation),
        animationDuration: toNonNegativeNumber(merged.animationDuration, DEFAULTS.animationDuration),
        scrollContainer: toOptionalSelector(merged.scrollContainer) ?? merged.scrollContainer ?? null,
    };
};

// Проверка синтаксиса селектора: браузер бросает невнятный DOMException,
// пользователь должен получить сообщение с названием опции.
export const assertSelectorSyntax = (source, selector, optionName) => {
    if (typeof selector !== 'string' || !selector.trim()) {
        throw new TypeError(`[native-drag-n-sort] ${optionName} must be a non-empty CSS selector`);
    }
    try {
        // Метод вызывается на самом источнике: оторванный querySelector теряет this
        // и падает на любом селекторе.
        source.querySelector(selector);
    } catch {
        throw new TypeError(`[native-drag-n-sort] ${optionName} is not a valid CSS selector: "${selector}"`);
    }
    return selector;
};

export const createStyleCss = ({ cloneClass, draggingClass, ghostClass }) => `
            .${cloneClass} {
                position: fixed;
                cursor: grabbing;
                pointer-events: none;
            }
            .${draggingClass} {
                display: none;
            }
            .${ghostClass} {
                opacity: 0.5;
                background-color: #eee;
                border: 1px dashed #ccc;
                pointer-events: none;
            }
        `;

export const createDebugCss = () => `
            .ds-debug-info {
                position: fixed;
                width: 150px;
                height: 150px;
                background-color: #fff;
                border: 1px solid #ccc;
                display: flex;
                padding: 20px 40px;
                right: 0;
                bottom: 0;
            }
            .ds-debug-container {
                width: 100%;
                height: 100%;
                position: relative;
                background-color: #f0f0f0;
            }
            .ds-debug-cursor-level {
                position: absolute;
                top: 0;
                width: 100%;
                height: 2px;
                background-color: #000;
            }
        `;

// Реестр стилей: одинаковый набор классов подключается один раз на все инстансы
// и удаляется, когда его отпустил последний потребитель.
export const createStyleRegistry = ({ document: doc }) => {
    const entries = new Map();

    const acquire = (signature, css) => {
        let entry = entries.get(signature);
        if (!entry) {
            const el = doc.createElement('style');
            el.textContent = css;
            doc.head.appendChild(el);
            entry = { el, doc, signature, count: 0 };
            entries.set(signature, entry);
        }
        entry.count += 1;
        return entry;
    };

    const release = (entry) => {
        if (!entry) return;
        // Стиль мог быть получен из другого документа (iframe, повторный импорт):
        // его счётчик живёт в чужом реестре, здесь можно только убрать узел.
        if (entry.doc !== doc) {
            entry.el.remove();
            return;
        }
        entry.count -= 1;
        if (entry.count <= 0) {
            entry.el.remove();
            entries.delete(entry.signature);
        }
    };

    return { acquire, release, size: () => entries.size };
};

// Реестр привязан к документу: один и тот же класс в разных документах
// (iframe, несколько jsdom в тестах) должен давать разные <style>.
const styleRegistries = new WeakMap();

const getStyleRegistry = () => {
    let registry = styleRegistries.get(document);
    if (!registry) {
        registry = createStyleRegistry({ document });
        styleRegistries.set(document, registry);
    }
    return registry;
};

const acquireStyle = (signature, css) => getStyleRegistry().acquire(signature, css);

const releaseStyle = (entry) => getStyleRegistry().release(entry);

// Классификатор item-элементов. Результат matches() кэшируется: именно он
// стоит дорого, а порядок детей читается «вживую» — ghost постоянно переносится.
// matches инъектируется, поэтому значение проверяется только на «объектность»:
// узлы без matches (текст, комментарий) просто не являются элементами.
export const createItemClassifier = (
    selector,
    { matches = (el, sel) => (typeof el.matches === 'function' ? el.matches(sel) : false) } = {},
) => {
    let cache = new WeakMap();

    const isItem = (el) => {
        if (!el || typeof el !== 'object') return false;
        const cached = cache.get(el);
        if (cached !== undefined) return cached;
        const result = Boolean(matches(el, selector));
        cache.set(el, result);
        return result;
    };

    // DOM мог измениться между перетаскиваниями — кэш пересобирается
    isItem.reset = () => { cache = new WeakMap(); };
    return isItem;
};

// Резолвер вложенного контейнера внутри элемента, с тем же принципом кэширования.
export const createChildContainerResolver = (
    selector,
    { query = (el, sel) => el.querySelector(sel) } = {},
) => {
    let cache = new WeakMap();

    const resolve = (item) => {
        if (!item) return null;
        if (cache.has(item)) return cache.get(item);
        const found = query(item, selector);
        cache.set(item, found);
        return found;
    };

    resolve.reset = () => { cache = new WeakMap(); };
    return resolve;
};

// Единственное правило «что считать пунктом списка»: item-элемент, не равный
// исключённому. Один проход собирает и порядок, и индексы — этим пользуются
// и кэш горячего пути, и публичные хелперы ниже.
export const collectItems = (children, isItem, { exclude = null } = {}) => {
    const all = [];
    const index = new Map();
    for (const el of children) {
        if (exclude && el === exclude) continue;
        if (!isItem(el)) continue;
        index.set(el, all.length);
        all.push(el);
    }
    return { all, index };
};

// Индекс элемента среди item-детей контейнера.
// exclude — перетаскиваемый элемент: его индекс считается «как будто его нет».
export const getItemIndex = (children, isItem, target, { exclude = null } = {}) => {
    const { index } = collectItems(children, isItem, { exclude });
    return index.has(target) ? index.get(target) : -1;
};

// Куда встанет элемент: перед целью, внутрь неё или после.
// Элемент с вложенным списком делится на три зоны, плоский — на две.
export const resolveDropZone = ({ innerY, height, hasChildContainer }) => {
    // Нулевая высота — элемент не отрисован: зоны не определены, безопасный дефолт «перед».
    if (!(height > 0)) return 'before';
    if (!hasChildContainer) {
        return innerY * 100 < height * 51 ? 'before' : 'after';
    }
    const third = height / 3;
    if (innerY < third) return 'before';
    if (innerY > third * 2) return 'after';
    return 'in';
};

export const getTargetContainer = (referenceElement, position) =>
    (position === 'in' ? referenceElement : referenceElement.parentElement);

// Позиция вставки в пустом месте контейнера — когда курсор между пунктами,
// а не над самим пунктом. Считается по ближайшему соседу: перед первым пунктом,
// чей верх ниже курсора. Ниже последнего пункта возвращается null — там работает
// обычное «внутрь контейнера», что даёт тот же индекс в конце списка.
// Раньше любое такое место трактовалось как «внутрь контейнера», то есть appendChild —
// ghost улетал в конец списка. На списке с промежутками это давало скачки индекса
// вперёд и обратно: индикатор мерцал между 2-й и 3-й позицией.
export const resolveContainerInsertion = ({ y, items, getRect, monotonic = false }) => {
    if (!items.length) return null;

    if (monotonic) {
        // items идут в DOM-порядке, верхушки монотонны, поэтому первый пункт ниже
        // курсора находится бинарным поиском: ~10 замеров на 1000 пунктов
        // вместо 1000 замеров на каждый кадр движения.
        let low = 0;
        let high = items.length - 1;
        let found = -1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (getRect(items[mid]).top > y) {
                found = mid;
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }
        return found === -1 ? null : { reference: items[found], position: 'before' };
    }

    // Немонотонный layout (сетка в колонках, абсолютное позиционирование):
    // порядок верхушек не гарантирован, поэтому нужен линейный поиск.
    for (const el of items) {
        if (getRect(el).top > y) return { reference: el, position: 'before' };
    }
    return null;
};

// Монотонны ли верхушки элементов сверху вниз. Сетка в колонках и абсолютное
// позиционирование это свойство нарушают — тогда бинарный поиск неприменим.
// Проверка стоит один проход и выполняется один раз за перетаскивание.
export const isMonotonicLayout = ({ items, getRect }) => {
    let previous = -Infinity;
    for (const el of items) {
        const top = getRect(el).top;
        if (top < previous) return false;
        previous = top;
    }
    return true;
};

// Индикатор — обычный элемент потока: пока он стоит в списке, он сдвигает соседей
// и меняет их высоту (попав внутрь вложенного списка, он растягивает родителя).
// Если зону считать по такой геометрии, решение зависит от собственного прошлого
// результата: курсор оказывается в чужой зоне, индикатор прыгает обратно — мерцание.
// Поэтому на время измерения индикатор убирается из DOM, а не просто скрывается:
// display: none оставляет его ребёнком контейнера, и тогда селекторы вида :empty
// (типичный способ не занимать место пустым списком) перестают срабатывать.
// Пустой список с padding начинает растягивать родителя, курсор уходит из своей зоны,
// индикатор возвращается — и так по кругу на каждом пикселе границы.
export const detachGhost = (ghost) => {
    if (!ghost || !ghost.parentNode) {
        return { detached: false, parent: null, restore: () => {} };
    }

    const parent = ghost.parentNode;
    const next = ghost.nextSibling;
    parent.removeChild(ghost);

    return {
        detached: true,
        parent,
        restore: () => {
            if (ghost.isConnected) return;
            if (next && next.parentNode === parent) {
                parent.insertBefore(ghost, next);
            } else {
                parent.appendChild(ghost);
            }
        },
    };
};

// Курсор сместился от точки нажатия не меньше, чем на порог.
export const hasExceededThreshold = ({ x, y, startX, startY, threshold }) =>
    Math.hypot(x - startX, y - startY) >= threshold;

// Сериализуемый payload события — без ссылок на DOM-узлы.
export const buildPayload = ({
    getItemId,
    getContainerId,
    draggedItem,
    fromContainer,
    fromIndex,
    toContainer,
    toIndex,
    position,
}) => ({
    itemId: getItemId(draggedItem),
    fromContainerId: getContainerId(fromContainer),
    fromIndex,
    toContainerId: toContainer ? getContainerId(toContainer) : null,
    toIndex,
    position,
});

export const shouldEmitDragOver = (prev, next) =>
    prev.toContainer !== next.toContainer ||
    prev.toIndex !== next.toIndex ||
    prev.position !== next.position;

export const isScrollableStyle = ({ overflowY, scrollHeight, clientHeight }) =>
    SCROLLABLE_OVERFLOW.includes(overflowY) && scrollHeight > clientHeight + 1;

// Направление автоскролла у края контейнера: -speed вверх, +speed вниз, 0 в середине.
export const getScrollDelta = ({ y, top, bottom, threshold, speed }) => {
    if (speed === 0) return 0; // -0 в scrollTop бессмысленен и ломает строгие сравнения
    if (y < top + threshold) return -speed;
    if (y > bottom - threshold) return speed;
    return 0;
};

// Координаты курсора из события мыши или касания.
// У touchend список touches пуст, поэтому есть фолбэк на changedTouches.
export const getCoordinates = (event) => {
    const isTouch = String(event?.type ?? '').includes('touch');
    if (!isTouch) {
        return { x: event?.clientX ?? 0, y: event?.clientY ?? 0 };
    }
    const source = event.touches?.[0] ?? event.changedTouches?.[0];
    return { x: source?.clientX ?? 0, y: source?.clientY ?? 0 };
};

// Клон перетаскиваемого элемента создаётся один раз за перетаскивание:
// глубокий клон поддерева дорог, а исходник за время drag не меняется.
export const createDragCloneCache = ({ cloneNode, removeClass }) => {
    let copy = null;

    return {
        get(item) {
            if (!copy) {
                copy = cloneNode(item);
                removeClass(copy);
            }
            return copy;
        },
        reset() { copy = null; },
    };
};

// Диапазон элементов, попадающих в вертикальное окно. Элементы идут в DOM-порядке,
// а у вертикального списка верхушки монотонны, поэтому границы находятся
// бинарным поиском: ~2*log2(n) замеров вместо n.
// Найденные границы проверяются по соседям: при немонотонном layout
// (сетка в колонках, абсолютное позиционирование) возвращается весь диапазон —
// корректность важнее экономии.
export const visibleChildRange = ({ children, getRect, windowTop, windowBottom }) => {
    const total = children.length;
    const all = { start: 0, end: total - 1 };
    if (total === 0) return { start: 0, end: -1 };
    if (!(windowBottom > windowTop)) return all;

    // Первый элемент, который заканчивается ниже верха окна.
    let low = 0;
    let high = total - 1;
    let start = total;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (getRect(children[mid]).bottom > windowTop) {
            start = mid;
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }
    if (start === total) return { start: 0, end: -1 };

    // Последний элемент, который начинается выше низа окна.
    low = start;
    high = total - 1;
    let end = start - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (getRect(children[mid]).top < windowBottom) {
            end = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    // Соседи за границами не должны быть видимы — иначе поиск промахнулся.
    const before = start > 0 ? getRect(children[start - 1]) : null;
    const after = end + 1 < total ? getRect(children[end + 1]) : null;
    if (before && before.bottom > windowTop) return all;
    if (after && after.top < windowBottom) return all;

    return { start, end };
};

// Снимок позиций элементов, которые могут сместиться: прямые item-дети
// затронутых контейнеров, без перетаскиваемого элемента.
// Анимировать всё дерево бессмысленно и дорого — двигаются только соседи,
// а из соседей видны только те, что попали в окно: на списке в 1000 строк
// снимок и обратный проход FLIP читают геометрию ~20 строк вместо 1000.
export const captureRects = ({
    containers,
    isItem,
    exclude = null,
    getRect,
    windowTop = null,
    windowBottom = null,
}) => {
    const rects = new Map();
    const hasWindow = windowTop !== null && windowBottom !== null;

    for (const container of containers) {
        if (!container) continue;

        // Живая коллекция, а не копия: на 1000+ детей копия стоила O(n)
        // на каждую смену цели. Границы окна ищутся по индексам.
        const children = container.children;

        if (!hasWindow) {
            for (const el of children) {
                if (el === exclude || !isItem(el)) continue;
                rects.set(el, getRect(el));
            }
            continue;
        }

        // Границы окна — по сырым детям: геометрия есть у каждого элемента,
        // поэтому сам поиск стоит ~2*log2(n) вместо n. isItem спрашивается
        // только внутри найденного диапазона.
        const { start, end } = visibleChildRange({ children, getRect, windowTop, windowBottom });
        for (let i = start; i <= end; i += 1) {
            const el = children[i];
            if (!el || el === exclude || !isItem(el)) continue;
            rects.set(el, getRect(el));
        }
    }
    return rects;
};

// FLIP: смещение, которое нужно инвертировать, чтобы элемент «доехал» сам.
export const computeFlipTransforms = ({ rects, getRect, isConnected = () => true }) => {
    const moved = [];
    if (!rects) return moved;
    for (const [el, first] of rects) {
        if (!isConnected(el)) continue;
        const last = getRect(el);
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        moved.push({ el, dx, dy });
    }
    return moved;
};

// Один общий реестр на документ: разные инстансы с одинаковыми классами
// делят один <style>. Создаётся лениво — на импорте document может отсутствовать.
export default function dragNDrop(options = {}) {
    // Конфигурация с вашими параметрами
    const config = normalizeOptions(options);

    // Опечатка в селекторе должна давать понятное сообщение с названием опции,
    // а не невнятный DOMException из недр querySelector.
    assertSelectorSyntax(document, config.containerSelector, 'containerSelector');
    assertSelectorSyntax(document, config.itemSelector, 'itemSelector');
    if (config.handleSelector) {
        assertSelectorSyntax(document, config.handleSelector, 'handleSelector');
    }
    if (typeof config.scrollContainer === 'string') {
        assertSelectorSyntax(document, config.scrollContainer, 'scrollContainer');
    }

    // Состояние
    const state = {
        container: document.querySelector(config.containerSelector),
        isDragging: false,
        draggedItem: null,
        ghostItem: null,
        currentDropTarget: null,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        dragDelayTimer: null,
        // Элемент, ожидающий старта перетаскивания (до истечения dragDelay и порога)
        pendingItem: null,
        // Истекла ли задержка dragDelay
        delayElapsed: false,
        fromIndex: null,
        fromContainer: null,
        toIndex: null,
        toContainer: null,
        position: null,
        // Предыдущая цель — чтобы эмитить dragOver только при изменениях
        prevToContainer: null,
        prevToIndex: null,
        prevPosition: null,
        // Последняя цель ghost — чтобы не пересоздавать его без изменений
        lastReference: null,
        lastPosition: null,
        // Индикатор, вынутый из DOM на время измерения, и контейнер, где он стоял
        detachedGhost: null,
        ghostHomeParent: null,
        // Кэш элементов и цели автоскролла на время перетаскивания
        scrollTarget: null,
        scrollRect: null,
        scrollRectTop: null,
        debugElement: null, // индикатор уровня курсора внутри элемента
    };

    // Основные элементы
    if (!state.container) return;

    // Стили используют настраиваемые классы из конфига.
    // Одинаковый набор классов переиспользует один общий <style> на все инстансы.
    let styleEntry = null;
    let styleSignature = null;

    const applyStyles = () => {
        const signature = `${config.cloneClass}|${config.draggingClass}|${config.ghostClass}`;
        if (signature === styleSignature) return;

        const nextEntry = acquireStyle(signature, createStyleCss(config));
        releaseStyle(styleEntry);
        styleEntry = nextEntry;
        styleSignature = signature;
    };

    // Debug-оверлей создаётся на инстанс, но <style> для него общий.
    // id не используются: несколько debug-инстансов не конфликтуют.
    let debugInfo = null;
    let debugContainer = null;
    let debugStyleEntry = null;

    const setupDebug = () => {
        if (debugInfo) return;

        debugStyleEntry = acquireStyle(DEBUG_STYLE_SIGNATURE, createDebugCss());

        debugInfo = document.createElement('div');
        debugInfo.classList.add('ds-debug-info');

        debugContainer = document.createElement('div');
        debugContainer.classList.add('ds-debug-container');

        state.debugElement = document.createElement('div');
        state.debugElement.classList.add('ds-debug-cursor-level');

        document.body.appendChild(debugInfo);
        debugInfo.appendChild(debugContainer);
        debugContainer.appendChild(state.debugElement);
    };

    const teardownDebug = () => {
        if (!debugInfo) return;

        debugInfo.remove();
        debugInfo = null;
        debugContainer = null;
        state.debugElement = null;

        releaseStyle(debugStyleEntry);
        debugStyleEntry = null;
    };

    applyStyles();
    if (config.debug) setupDebug();

    // Вспомогательные функции
    // Пользовательские колбэки вызываются из горячего пути перетаскивания: исключение
    // в них не должно оставлять модуль в полудrag-состоянии, поэтому оно гасится здесь.
    const reportError = (name, error) => {
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
            console.error(`[native-drag-n-sort] ${name}() threw an error:`, error);
        }
    };

    const callUser = (name, fn, fallback, ...args) => {
        if (typeof fn !== 'function') return fallback;
        try {
            return fn(...args);
        } catch (error) {
            reportError(name, error);
            return fallback;
        }
    };

    const getItemId = (el) => callUser('getItemId', config.getItemId, null, el);
    const getContainerId = (el) => callUser('getContainerId', config.getContainerId, null, el);

    // Сериализуемый payload события — без ссылок на DOM-узлы
    const currentPayload = () => buildPayload({
        getItemId,
        getContainerId,
        draggedItem: state.draggedItem,
        fromContainer: state.fromContainer,
        fromIndex: state.fromIndex,
        toContainer: state.toContainer,
        toIndex: state.toIndex,
        position: state.position,
    });

    const dispatch = (type, detail) => {
        state.container.dispatchEvent(new CustomEvent(type, { detail }));

        // dragOver и drop — единственные события, на которые потребитель (Vue/React)
        // обычно отвечает перерисовкой списка. После них кэш структуры недействителен.
        // dragMove сюда не входит: он приходит на каждый кадр, а перерисовывать
        // список на каждое движение курсора никто не станет.
        if (type === 'dragOver' || type === 'drop') {
            itemChildrenCache = new WeakMap();
            monotonicCache = new WeakMap();
        }
    };

    // Порядок детей читается всегда «вживую» (ghost постоянно переносится),
    // а результат matches() кэшируется: именно он и стоит дорого.
    // Кэши пересоздаются на старте каждого перетаскивания: потребитель (Vue/React)
    // мог отрендерить или убрать вложенный список между drag.
    const isItem = createItemClassifier(config.itemSelector);
    const getChildContainer = createChildContainerResolver(config.containerSelector);

    // Список item-детей контейнера нужен на каждом кадре: «пуст ли контейнер»,
    // промежутки между пунктами, индекс цели. Перебор детей — O(n), поэтому
    // результат кэшируется на время перетаскивания.
    // Ключ — только число детей (минус индикатор): состав и порядок меняем либо мы
    // (перенос индикатора), либо потребитель, а после его событий кэш сбрасывается.
    // Пересборка стоит одного прохода: isItem кэширован отдельно (WeakMap).
    let itemChildrenCache = new WeakMap();

    // Монотонность верхушек по контейнерам: результат живёт до конца drag.
    let monotonicCache = new WeakMap();

    const itemChildrenOf = (container) => {
        const ghost = state.currentDropTarget;
        const ghostHere = Boolean(ghost) && ghost.parentElement === container;

        // Ключ — только число детей (минус индикатор). Этого достаточно, потому что
        // любое изменение состава или порядка сами меняем мы (перенос индикатора)
        // либо потребитель — а после его событий кэш сбрасывается явно.
        const count = container.children.length - (ghostHere ? 1 : 0);

        const cached = itemChildrenCache.get(container);
        if (cached && cached.count === count) return cached;

        // all — item-дети без индикатора: их состав не меняется от его перемещений.
        const { all, index } = collectItems(container.children, isItem, { exclude: ghost });

        const entry = { all, index, count };
        itemChildrenCache.set(container, entry);
        return entry;
    };

    // item-дети контейнера без индикатора — в том же порядке, что и в DOM.
    const containerItems = (container) => itemChildrenOf(container).all;

    // Пуст ли контейнер: индикатор в нём не считается пунктом.
    const isEmptyContainer = (container) => itemChildrenOf(container).all.length === 0;

    // Позиция индикатора среди item-детей контейнера (сам индикатор считается).
    // Берётся по ближайшему item-соседу справа: обычно это один шаг,
    // а кэш пунктов от перемещения индикатора не зависит.
    const ghostSlot = (container, entry) => {
        const ghost = state.currentDropTarget;
        if (!ghost || ghost.parentElement !== container) return -1;
        for (let node = ghost.nextElementSibling; node; node = node.nextElementSibling) {
            const position = entry.index.get(node);
            if (position !== undefined) return position;
        }
        return entry.all.length;
    };

    // Индекс элемента среди item-детей контейнера, вместе с индикатором:
    // индикатор — клон пункта и в списке тоже является пунктом.
    const itemPositionOf = (container, el) => {
        const entry = itemChildrenOf(container);
        if (el === state.currentDropTarget) return ghostSlot(container, entry);

        const position = entry.index.get(el);
        if (position === undefined) return -1;

        const slot = ghostSlot(container, entry);
        return slot !== -1 && slot <= position ? position + 1 : position;
    };

    // Индекс элемента среди item-детей контейнера.
    // excludeDragged — исключить перетаскиваемый элемент: его индекс считается
    // «как будто его нет», это итоговый индекс после перемещения.
    const indexOfItem = (container, item, excludeDragged = false) => {
        const position = itemPositionOf(container, item);
        if (position === -1 || !excludeDragged) return position;

        const draggedPosition = itemPositionOf(container, state.draggedItem);
        return draggedPosition !== -1 && draggedPosition < position
            ? position - 1
            : position;
    };

    // Ближайший контейнер-предок элемента (сам элемент не учитывается).
    const getClosestContainer = (el) => el?.closest?.(config.containerSelector) ?? null;

    // Скроллируется ли элемент по вертикали.
    const isScrollable = (el) => {
        if (!el || el.nodeType !== 1) return false;
        if (el === document.body || el === document.documentElement) return false;
        const { overflowY } = window.getComputedStyle(el);
        return isScrollableStyle({
            overflowY,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
        });
    };

    // Ближайший скроллируемый предок элемента.
    const getScrollableAncestor = (el) => {
        let node = el;
        while (node && node !== document.body && node !== document.documentElement) {
            if (isScrollable(node)) return node;
            node = node.parentElement;
        }
        return null;
    };

    // Клон перетаскиваемого элемента без класса перетаскивания.
    // Клонируется один раз за перетаскивание: глубокий клон поддерева дорог,
    // а исходник за время drag не меняется.
    const dragClone = createDragCloneCache({
        cloneNode: (item) => item.cloneNode(true),
        removeClass: (copy) => copy.classList.remove(config.draggingClass),
    });

    const getDragClone = () => dragClone.get(state.draggedItem);

    // Снимок позиций элементов, которые могут сместиться:
    // прямые item-дети затронутых контейнеров, без перетаскиваемого элемента.
    // Анимировать всё дерево бессмысленно и дорого — двигаются только соседи,
    // а из соседей — только те, что видны в окне (на 1000 пунктов иначе
    // второй проход FLIP читает геометрию каждой строки).
    const captureItemRects = (containers) => captureRects({
        containers,
        isItem,
        exclude: state.draggedItem,
        getRect: (el) => el.getBoundingClientRect(),
        windowTop: -VIEWPORT_MARGIN,
        windowBottom: window.innerHeight + VIEWPORT_MARGIN,
    });

    // FLIP: инвертируем смещение и плавно возвращаем элементы на место.
    // Через Web Animations API, а не inline-стили с transition:
    //   1) не нужен принудительный reflow (чтение offsetWidth), чтобы «включить»
    //      инверсию до старта перехода. Его цена линейна по размеру документа;
    //   2) не нужны обработчики transitionend и очистка inline-стилей —
    //      анимация сама не оставляет следов (fill: 'none').
    // Предыдущая анимация элемента отменяется: при частой смене цели
    // (каждые несколько пикселей) новый Animation на каждый кадр накапливался бы
    // в compositor — на длинном списке это десятки тысяч объектов и просадка
    // кадра до десятков миллисекунд.
    // Если el.animate недоступен (старый браузер, jsdom), элементы просто
    // занимают новое место без анимации — порядок от этого не страдает.
    const flipAnimations = new WeakMap();

    const playFlip = (rects) => {
        if (!rects || !rects.size) return;
        const duration = typeof config.animation === 'number' ? config.animation : config.animationDuration;
        const moved = computeFlipTransforms({
            rects,
            getRect: (el) => el.getBoundingClientRect(),
        });
        if (!moved.length) return;

        for (const { el, dx, dy } of moved) {
            if (typeof el.animate !== 'function') continue;

            const previous = flipAnimations.get(el);
            if (previous) previous.cancel();

            const animation = el.animate(
                [
                    { transform: `translate(${dx}px, ${dy}px)` },
                    { transform: 'translate(0px, 0px)' },
                ],
                { duration, easing: 'ease', fill: 'none' },
            );
            flipAnimations.set(el, animation);
        }
    };

    // Сброс состояния после завершения/отмены перетаскивания.
    const resetState = () => {
        Object.assign(state, {
            isDragging: false,
            pendingItem: null,
            delayElapsed: false,
            draggedItem: null,
            ghostItem: null,
            currentDropTarget: null,
            fromContainer: null,
            fromIndex: null,
            toContainer: null,
            toIndex: null,
            position: null,
            prevToContainer: null,
            prevToIndex: null,
            prevPosition: null,
            lastReference: null,
            lastPosition: null,
            scrollTarget: null,
            scrollRect: null,
            scrollRectTop: null,
            startX: 0,
            startY: 0,
            lastX: 0,
            lastY: 0,
        });
    };

    const removeGhostElement = () => {
        if (state.currentDropTarget) {
            state.currentDropTarget.remove();
            state.currentDropTarget = null;
        }
        state.lastReference = null;
        state.lastPosition = null;
    };

    // Удаление ghost-элемента и снятие класса перетаскивания.
    const cleanupDrag = () => {
        removeGhostElement();
        if (state.ghostItem?.parentNode) {
            state.ghostItem.parentNode.removeChild(state.ghostItem);
        }
        if (state.draggedItem) {
            state.draggedItem.classList.remove(config.draggingClass);
        }
    };

    // Пересчитываем данные цели по позиции ghost в DOM
    const updateTargetData = (position) => {
        const ghost = state.currentDropTarget;
        // Индикатор может быть уже удалён из DOM (ре-рендер потребителем) —
        // в этом случае цель неизвестна, а не «осталась прежней».
        if (!ghost || !ghost.isConnected || !ghost.parentElement) {
            state.toContainer = null;
            state.toIndex = null;
            state.position = null;
            return;
        }

        state.toContainer = ghost.parentElement;
        // Индекс считаем без перетаскиваемого элемента — это итоговый индекс после перемещения
        state.toIndex = indexOfItem(ghost.parentElement, ghost, true);
        state.position = position;
    };

    const createGhostElement = (referenceElement, position) => {
        // Нельзя класть элемент внутрь самого себя (или своего потомка) — иначе цикл в DOM
        if (referenceElement === state.draggedItem || state.draggedItem?.contains(referenceElement)) {
            return;
        }

        // Потребитель может запретить бросок в конкретный контейнер.
        // Исключение внутри canDrop не должно ломать перетаскивание — считаем это запретом.
        const targetContainer = getTargetContainer(referenceElement, position);
        if (config.canDrop && !callUser('canDrop', config.canDrop, false, state.draggedItem, targetContainer)) {
            return;
        }

        // Цель не изменилась — не пересоздаём ghost (и не дёргаем анимацию)
        if (state.lastReference === referenceElement && state.lastPosition === position) {
            return;
        }

        // Анимируются только затронутые контейнеры: старый и новый.
        // Индикатор на время измерения вынут из DOM, поэтому его текущий родитель — null;
        // прежний контейнер берётся из снимка, сделанного до измерения.
        const previousContainer = state.currentDropTarget
            ? (state.ghostHomeParent ?? state.currentDropTarget.parentElement)
            : null;
        // Старый и новый контейнер могут совпадать — тогда снимок делается один раз.
        const affected = previousContainer && previousContainer !== targetContainer
            ? [previousContainer, targetContainer]
            : [targetContainer];
        const rects = config.animation ? captureItemRects(affected) : null;

        // Индикатор создаётся один раз за перетаскивание и дальше только переносится —
        // глубокий клон поддерева на каждую смену цели не нужен.
        // Проверка isConnected: потребитель (Vue/React) мог перерисовать контейнер
        // и выбросить индикатор вместе с содержимым — тогда его нужно создать заново.
        // Отсоединённый на время измерения индикатор — не потерянный: он вернётся в DOM ниже.
        const detachedByMeasure = state.currentDropTarget === state.detachedGhost;
        if (!state.currentDropTarget || (!state.currentDropTarget.isConnected && !detachedByMeasure)) {
            state.currentDropTarget = getDragClone().cloneNode(true);
            state.currentDropTarget.classList.add(config.ghostClass);
            state.lastReference = null;
            state.lastPosition = null;
        }

        if (position === 'in') {
            referenceElement.appendChild(state.currentDropTarget);
        } else if (position === 'before') {
            referenceElement.before(state.currentDropTarget);
        } else {
            referenceElement.after(state.currentDropTarget);
        }

        state.lastReference = referenceElement;
        state.lastPosition = position;

        updateTargetData(position);

        if (rects) playFlip(rects);
    };

    // Автоскролл: скроллим явно заданный контейнер либо ближайший скроллируемый предок
    // под курсором, с фолбэком на корневой контейнер (обратная совместимость).
    // Цель резолвится один раз за перетаскивание и кэшируется.
    const handleAutoScroll = (elementsUnderPointer, y) => {
        let scrollTarget = state.scrollTarget;
        if (!scrollTarget || !scrollTarget.isConnected) {
            if (config.scrollContainer) {
                // Явно заданный контейнер (селектор или элемент)
                scrollTarget = typeof config.scrollContainer === 'string'
                    ? document.querySelector(config.scrollContainer)
                    : config.scrollContainer;
            } else {
                // Достаточно верхнего элемента под курсором
                scrollTarget = getScrollableAncestor(elementsUnderPointer[0]) || state.container;
            }
            state.scrollTarget = scrollTarget;
            state.scrollRect = null;
        }
        if (!scrollTarget) return;

        // getBoundingClientRect форсирует layout, поэтому читаем его только когда
        // контейнер реально прокрутился (или ещё не измерялся).
        if (!state.scrollRect || state.scrollRectTop !== scrollTarget.scrollTop) {
            state.scrollRect = scrollTarget.getBoundingClientRect();
            state.scrollRectTop = scrollTarget.scrollTop;
        }
        const rect = state.scrollRect;

        const delta = getScrollDelta({
            y,
            top: rect.top,
            bottom: rect.bottom,
            threshold: config.scrollThreshold,
            speed: config.scrollSpeed,
        });
        if (delta !== 0) {
            scrollTarget.scrollTop += delta;
        }
    };

    // Курсор попал в контейнер, но не в конкретный пункт: промежуток между пунктами
    // либо место ниже последнего пункта. Промежуток считается по ближайшему соседу,
    // ниже последнего — обычное «внутрь контейнера» (тот же индекс в конце списка).
    const placeInContainerGap = (container, y) => {
        const items = containerItems(container);
        const insertion = resolveContainerInsertion({
            y,
            items,
            getRect: (el) => el.getBoundingClientRect(),
            monotonic: layoutMonotonic(container, items),
        });
        if (insertion) {
            createGhostElement(insertion.reference, insertion.position);
        } else {
            createGhostElement(container, 'in');
        }
    };

    // Монотонность проверяется один раз на контейнер за перетаскивание:
    // от неё зависит, можно ли искать вставку бинарным поиском.
    const layoutMonotonic = (container, items) => {
        const cached = monotonicCache.get(container);
        if (cached !== undefined && cached.count === items.length) return cached.value;

        const value = isMonotonicLayout({ items, getRect: (el) => el.getBoundingClientRect() });
        monotonicCache.set(container, { count: items.length, value });
        return value;
    };

    const updateDropTarget = (x, y) => {
        // Вся геометрия — и hit-test, и прямоугольники — считается без индикатора.
        // Иначе цель зависит от собственного прошлого решения: индикатор сдвигает
        // соседей и растягивает вложенный список, курсор попадает в чужую зону,
        // индикатор прыгает обратно — список мерцает, а зона вставки уезжает.
        // Индикатор именно отсоединяется (а не скрывается): пока он остаётся ребёнком
        // контейнера, селекторы :empty не срабатывают и пустой список с padding
        // растягивает родителя — это давало дрожание на границе зон.
        const detach = detachGhost(state.currentDropTarget);
        state.detachedGhost = detach.detached ? state.currentDropTarget : null;
        state.ghostHomeParent = detach.parent;

        try {
            const elementsUnderPointer = document.elementsFromPoint(x, y)
                // ghost-элемент и клон под курсором не должны участвовать в поиске цели
                .filter((el) => el !== state.ghostItem && el !== state.currentDropTarget);

            // Автоскролл ближайшего скроллируемого предка под курсором
            handleAutoScroll(elementsUnderPointer, y);

            // Один проход: ищем и элемент, и контейнер под курсором
            let itemElement = null;
            let itemContainer = null;
            for (const el of elementsUnderPointer) {
                if (!itemElement && isItem(el)) itemElement = el;
                if (!itemContainer && el.matches(config.containerSelector)) itemContainer = el;
                if (itemElement && itemContainer) break;
            }

            if (itemContainer && isEmptyContainer(itemContainer)) {
                // Пустой контейнер: единственная возможная цель — «внутрь»
                createGhostElement(itemContainer, 'in');
                return;
            }
            if (!itemElement) return;

            const rect = itemElement.getBoundingClientRect();
            const innerY = y - rect.top; // положение курсора внутри элемента

            if (config.debug && state.debugElement) {
                state.debugElement.style.top = `${(innerY * 100) / rect.height}%`;
            }

            // Вложенный контейнер внутри элемента — цель для зоны 'in'.
            // Курсор прямо над вложенным контейнером, а не над вложенным элементом внутри него.
            // Проверка через contains: itemContainer уже найден hit-test'ом, обход поддерева не нужен
            // и корректно работает при нескольких вложенных контейнерах в одном элементе.
            const overChildContainer = itemContainer
                && itemContainer !== itemElement
                && itemElement.contains(itemContainer);

            if (overChildContainer) {
                // Промежуток между пунктами вложенного списка — не «в конец списка»
                placeInContainerGap(itemContainer, y);
                return;
            }

            // Плоский элемент делится на две зоны, элемент с вложенным списком — на три.
            const childContainer = getChildContainer(itemElement);
            const zone = resolveDropZone({
                innerY,
                height: rect.height,
                hasChildContainer: childContainer !== null,
            });

            createGhostElement(zone === 'in' ? childContainer : itemElement, zone);
        } finally {
            detach.restore();
            state.detachedGhost = null;
            state.ghostHomeParent = null;
        }
    };

    // Эмитим dragOver только когда цель изменилась
    const emitDragOverIfChanged = (payload) => {
        const changed = shouldEmitDragOver(
            {
                toContainer: state.prevToContainer,
                toIndex: state.prevToIndex,
                position: state.prevPosition,
            },
            {
                toContainer: state.toContainer,
                toIndex: state.toIndex,
                position: state.position,
            },
        );

        if (!changed) return;

        state.prevToContainer = state.toContainer;
        state.prevToIndex = state.toIndex;
        state.prevPosition = state.position;

        dispatch('dragOver', payload);
    };

    const startDrag = (item, x, y) => {
        state.pendingItem = null;
        state.delayElapsed = false;
        state.draggedItem = item;

        // DOM мог измениться после предыдущего drag — кэши структуры пересобираются
        isItem.reset();
        getChildContainer.reset();
        dragClone.reset();
        itemChildrenCache = new WeakMap();
        monotonicCache = new WeakMap();

        try {
            // Скрываем оригинальный элемент (но сохраняем его место)
            item.classList.add(config.draggingClass);

            const fromContainer = getClosestContainer(item.parentElement);
            if (fromContainer) {
                state.fromContainer = fromContainer;
                state.fromIndex = indexOfItem(fromContainer, item);
            }

            // Создаем элемент, который будет следовать за курсором
            state.ghostItem = getDragClone().cloneNode(true);
            state.ghostItem.classList.add(config.cloneClass);
            Object.assign(state.ghostItem.style, {
                left: `${x}px`,
                top: `${y}px`,
            });

            document.body.appendChild(state.ghostItem);
            state.isDragging = true;

            updateDropTarget(x, y);

            // Запоминаем стартовую цель, чтобы dragOver срабатывал только на изменениях
            state.prevToContainer = state.toContainer;
            state.prevToIndex = state.toIndex;
            state.prevPosition = state.position;

            dispatch('dragStart', currentPayload());
        } catch (error) {
            // Клон уже в body, оригинал скрыт — без отката перетаскивание «залипло» бы
            // навсегда: mouseup не увидел бы активного состояния.
            cleanupDrag();
            resetState();
            reportError('dragStart', error);
        }
    };

    const stopDrag = () => {
        cancelFrame();

        try {
            // drop приходит ДО изменений DOM, чтобы потребитель (фреймворк) взял управление
            if (state.toContainer) {
                dispatch('drop', currentPayload());
            }

            // В режиме 'dom' модуль сам перемещает реальный элемент (обратная совместимость).
            // В режиме 'manual' реальный DOM не трогаем — порядок меняет потребитель.
            if (config.reorder === 'dom' && state.currentDropTarget?.parentNode) {
                const targetContainer = state.currentDropTarget.parentNode;
                const rects = config.animation ? captureItemRects([targetContainer]) : null;
                state.currentDropTarget.replaceWith(state.draggedItem);
                state.toContainer = state.draggedItem.parentNode;
                state.toIndex = indexOfItem(state.draggedItem.parentNode, state.draggedItem);
                if (rects) playFlip(rects);
            }

            cleanupDrag();

            dispatch('dragEnd', currentPayload());
        } finally {
            // Артефакты и флаг убираются всегда: исключение в слушателе потребителя
            // не должно оставлять клон в body и isDragging === true.
            cleanupDrag();
            resetState();
        }
    };

    // Курсор сместился от точки нажатия не меньше, чем на dragThreshold.
    const exceededThreshold = (x, y) => hasExceededThreshold({
        x,
        y,
        startX: state.startX,
        startY: state.startY,
        threshold: config.dragThreshold,
    });

    // Троттлинг обработки движения через requestAnimationFrame:
    // за кадр выполняется один расчёт цели и одно обновление ghost.
    let rafId = null;
    let pendingPoint = null;
    let lastFramePoint = null;

    const cancelFrame = () => {
        if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        pendingPoint = null;
        lastFramePoint = null;
    };

    // Прерывание перетаскивания: активное — с событием dragCancel,
    // ожидающее старта — просто отменяет отложенный запуск.
    const cancelDrag = () => {
        clearTimeout(state.dragDelayTimer);
        cancelFrame();

        if (!state.isDragging) {
            state.pendingItem = null;
            state.delayElapsed = false;
            return;
        }

        cleanupDrag();

        dispatch('dragCancel', currentPayload());
        resetState();
    };

    const scheduleFrame = (x, y) => {
        // Точка не изменилась с прошлого кадра/запланированного — пересчёт не нужен
        const ref = pendingPoint || lastFramePoint;
        if (ref && ref.x === x && ref.y === y) return;

        pendingPoint = { x, y };
        if (rafId != null) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            const point = pendingPoint;
            pendingPoint = null;
            if (!point || !state.isDragging) return;

            lastFramePoint = point;

            if (state.ghostItem) {
                state.ghostItem.style.left = `${point.x}px`;
                state.ghostItem.style.top = `${point.y}px`;
            }

            updateDropTarget(point.x, point.y);

            const payload = currentPayload();
            emitDragOverIfChanged(payload);
            dispatch('dragMove', payload);
        });
    };

    const onPointerDown = (e) => {
        if (config.disabled) return;

        // Только основная кнопка мыши: правая открывает контекстное меню,
        // средняя — автопрокрутку, перетаскивать ими нельзя.
        // Для касаний button не определён — проверка не срабатывает.
        if (e.button != null && e.button !== 0) return;

        // Второе нажатие во время активного перетаскивания (второй палец,
        // вторая кнопка) не должно перехватывать управление.
        if (state.isDragging) return;

        // Если задан handleSelector — drag начинается только с ручки, иначе — с любого места элемента
        const origin = config.handleSelector
            ? e.target.closest(config.handleSelector)
            : e.target.closest(config.itemSelector);
        const item = origin?.closest(config.itemSelector);
        if (!item) return;

        // Потребитель может запретить перетаскивание конкретного элемента.
        // Исключение внутри предиката трактуется как запрет.
        if (config.canDrag && !callUser('canDrag', config.canDrag, false, item)) return;

        e.preventDefault();
        const { x, y } = getCoordinates(e);
        state.startX = x;
        state.startY = y;
        state.lastX = x;
        state.lastY = y;
        state.pendingItem = item;
        state.delayElapsed = false;

        clearTimeout(state.dragDelayTimer);
        state.dragDelayTimer = setTimeout(() => {
            state.delayElapsed = true;
            // Задержка истекла и порог уже пройден — стартуем сразу
            if (state.pendingItem && exceededThreshold(state.lastX, state.lastY)) {
                startDrag(state.pendingItem, state.lastX, state.lastY);
            }
        }, config.dragDelay);
    };

    const onPointerMove = (e) => {
        if (!state.isDragging) {
            // Ожидание старта: перетаскивание начнётся, когда истекла задержка
            // и курсор сместился не меньше, чем на dragThreshold
            if (state.pendingItem) {
                const { x, y } = getCoordinates(e);
                state.lastX = x;
                state.lastY = y;
                if (state.delayElapsed && exceededThreshold(x, y)) {
                    startDrag(state.pendingItem, x, y);
                }
            }
            return;
        }
        e.preventDefault();

        const { x, y } = getCoordinates(e);
        scheduleFrame(x, y);
    };

    const onPointerUp = () => {
        clearTimeout(state.dragDelayTimer);
        state.pendingItem = null;
        state.delayElapsed = false;
        if (state.isDragging) {
            stopDrag();
        }
    };

    // touchcancel означает, что браузер забрал касание (скролл, жест, потеря фокуса).
    // Завершать перетаскивание с перемещением элемента в этом случае нельзя.
    const onTouchCancel = () => {
        cancelDrag();
    };

    // Инициализация
    state.container.addEventListener('mousedown', onPointerDown);
    state.container.addEventListener('touchstart', onPointerDown, { passive: false });

    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('touchmove', onPointerMove, { passive: false });

    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchend', onPointerUp);
    document.addEventListener('touchcancel', onTouchCancel);

    // Публичный API
    let destroyed = false;

    return {
        // Снимает обработчики и освобождает общие стили.
        // Повторный вызов безопасен. Стили удаляются, когда их отпустит последний инстанс.
        destroy: () => {
            if (destroyed) return;
            destroyed = true;

            clearTimeout(state.dragDelayTimer);
            cancelFrame();

            // Отменяем активное перетаскивание без событий
            cleanupDrag();
            resetState();

            state.container.removeEventListener('mousedown', onPointerDown);
            state.container.removeEventListener('touchstart', onPointerDown);
            document.removeEventListener('mousemove', onPointerMove);
            document.removeEventListener('touchmove', onPointerMove);
            document.removeEventListener('mouseup', onPointerUp);
            document.removeEventListener('touchend', onPointerUp);
            document.removeEventListener('touchcancel', onTouchCancel);

            releaseStyle(styleEntry);
            styleEntry = null;
            styleSignature = null;

            teardownDebug();
        },

        // Перечитывает контейнер (после ре-рендера), обновляет опции и, если сменились
        // классы или флаг debug, пересобирает внедрённые стили и оверлей.
        refresh: (newOptions) => {
            if (destroyed) return;

            if (newOptions && typeof newOptions === 'object') {
                // Новые опции проходят ту же нормализацию, что и при создании:
                // иначе NaN или опечатка в селекторе просочились бы в рабочий инстанс.
                const merged = normalizeOptions({ ...config, ...newOptions });
                if (merged.containerSelector !== config.containerSelector) {
                    assertSelectorSyntax(document, merged.containerSelector, 'containerSelector');
                }
                if (merged.itemSelector !== config.itemSelector) {
                    assertSelectorSyntax(document, merged.itemSelector, 'itemSelector');
                }
                if (merged.handleSelector && merged.handleSelector !== config.handleSelector) {
                    assertSelectorSyntax(document, merged.handleSelector, 'handleSelector');
                }
                Object.assign(config, merged);
            }

            applyStyles();
            if (config.debug) {
                setupDebug();
            } else {
                teardownDebug();
            }

            const nextContainer = document.querySelector(config.containerSelector);
            if (nextContainer && nextContainer !== state.container) {
                state.container.removeEventListener('mousedown', onPointerDown);
                state.container.removeEventListener('touchstart', onPointerDown);
                state.container = nextContainer;
                state.container.addEventListener('mousedown', onPointerDown);
                state.container.addEventListener('touchstart', onPointerDown, { passive: false });
            }
        },

        // Сериализуемый снимок текущего состояния.
        getState: () => ({
            isDragging: state.isDragging,
            ...currentPayload(),
        }),

        // Прерывает перетаскивание: активное — с событием dragCancel,
        // ожидающее старта — просто отменяет отложенный запуск.
        cancel: () => {
            if (destroyed) return;
            cancelDrag();
        },
    };
}
