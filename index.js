// Общий реестр внедрённых <style> на уровне модуля.
// Одинаковые стили подключаются в <head> один раз на все инстансы
// и удаляются только когда не остаётся ни одного потребителя.
const styleRegistry = new Map();

const acquireStyle = (signature, css) => {
    let entry = styleRegistry.get(signature);
    if (!entry) {
        const el = document.createElement('style');
        el.textContent = css;
        document.head.appendChild(el);
        entry = { el, signature, count: 0 };
        styleRegistry.set(signature, entry);
    }
    entry.count++;
    return entry;
};

const releaseStyle = (entry) => {
    if (!entry) return;
    entry.count--;
    if (entry.count <= 0) {
        entry.el.remove();
        styleRegistry.delete(entry.signature);
    }
};

const DEBUG_STYLE_SIGNATURE = 'ds-debug';

export default function dragNDrop(options = {}) {
    // Конфигурация с вашими параметрами
    const config = {
        containerSelector: '.container',
        itemSelector: '.item',
        ghostClass: 'item-ghost',
        draggingClass: 'item-dragging',
        cloneClass: 'item-clone',
        handleSelector: null,
        dragDelay: 100,
        // Минимальное смещение курсора (px) до старта перетаскивания.
        // Drag начинается, когда истекла dragDelay И курсор сместился на это расстояние.
        dragThreshold: 5,
        scrollSpeed: 10,
        scrollThreshold: 50,
        debug: false,
        // Режим изменения порядка:
        // 'dom'    — модуль сам перемещает реальный элемент (обратная совместимость);
        // 'manual' — модуль не трогает реальный DOM, порядок меняет потребитель (например, Vue).
        reorder: 'dom',
        // Мапинг DOM → данные. По умолчанию читаем data-id.
        getItemId: (el) => el?.dataset?.id ?? null,
        getContainerId: (el) => el?.dataset?.id ?? el?.dataset?.containerId ?? null,
        // Полностью отключает перетаскивание (можно менять в рантайме через refresh()).
        disabled: false,
        // Предикат: можно ли начать перетаскивание элемента. (el) => boolean
        canDrag: null,
        // Предикат: можно ли бросить элемент в контейнер target. (el, target) => boolean
        canDrop: null,
        // FLIP-анимация перестроения элементов: true | false | число (длительность, мс)
        animation: false,
        // Длительность FLIP-анимации в мс (когда animation === true)
        animationDuration: 200,
        // Явный контейнер для автоскролла: CSS-селектор или элемент.
        // Если не задан — ищется ближайший скроллируемый предок под курсором.
        scrollContainer: null,
        ...options
    };

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
        // Кэш элементов и цели автоскролла на время перетаскивания
        scrollTarget: null,
        scrollRect: null,
        scrollRectTop: null,
        // Кэш глубокого клона перетаскиваемого элемента
        dragItemCopy: null,
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

        const nextEntry = acquireStyle(signature, `
            .${config.cloneClass} {
                position: fixed;
                cursor: grabbing;
                pointer-events: none;
            }
            .${config.draggingClass} {
                display: none;
            }
            .${config.ghostClass} {
                opacity: 0.5;
                background-color: #eee;
                border: 1px dashed #ccc;
                pointer-events: none;
            }
        `);
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

        debugStyleEntry = acquireStyle(DEBUG_STYLE_SIGNATURE, `
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
        `);

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
    const getCoordinates = (e) => {
        const isTouch = e.type.includes('touch');
        return {
            x: isTouch ? e.touches[0].clientX : e.clientX,
            y: isTouch ? e.touches[0].clientY : e.clientY
        };
    };

    // Сериализуемый payload события — без ссылок на DOM-узлы
    const buildPayload = () => ({
        itemId: config.getItemId(state.draggedItem),
        fromContainerId: config.getContainerId(state.fromContainer),
        fromIndex: state.fromIndex,
        toContainerId: state.toContainer ? config.getContainerId(state.toContainer) : null,
        toIndex: state.toIndex,
        position: state.position,
    });

    const dispatch = (type, detail) => {
        state.container.dispatchEvent(new CustomEvent(type, { detail }));
    };

    // Индекс элемента среди item-элементов контейнера.
    // excludeDragged — исключить перетаскиваемый элемент (для расчёта позиции ghost).
    const getItemIndex = (container, item, excludeDragged = false) => {
        let index = 0;
        for (const el of container.children) {
            if (!el.matches(config.itemSelector)) continue;
            if (excludeDragged && el === state.draggedItem) continue;
            if (el === item) return index;
            index++;
        }
        return -1;
    };

    // Ближайший контейнер-предок элемента (сам элемент не учитывается).
    const getClosestContainer = (el) => el?.closest?.(config.containerSelector) ?? null;

    // Вложенный контейнер внутри элемента (первый по дереву).
    // Результат кэшируется в WeakMap, чтобы не обходить поддерево на каждом кадре.
    // Кэш привязан к элементу и собирается сборщиком мусора вместе с ним.
    const childContainerCache = new WeakMap();
    const getChildContainer = (item) => {
        if (!item) return null;
        if (childContainerCache.has(item)) return childContainerCache.get(item);
        const found = item.querySelector(config.containerSelector);
        childContainerCache.set(item, found);
        return found;
    };

    // Есть ли в элементе вложенный контейнер (используется для выбора зон before/in/after).
    const hasChildContainer = (item) => getChildContainer(item) !== null;

    // Скроллируется ли элемент по вертикали.
    const isScrollable = (el) => {
        if (!el || el.nodeType !== 1) return false;
        if (el === document.body || el === document.documentElement) return false;
        const { overflowY } = window.getComputedStyle(el);
        const canScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
        return canScroll && el.scrollHeight > el.clientHeight + 1;
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

    // Контейнер, в который попадёт элемент при данной позиции ghost.
    const getTargetContainer = (referenceElement, position) =>
        position === 'in' ? referenceElement : referenceElement.parentElement;

    // Клон перетаскиваемого элемента без класса перетаскивания.
    // Клонируется один раз за перетаскивание: глубокий клон поддерева дорог,
    // а исходник за время drag не меняется.
    const getDragClone = () => {
        if (!state.dragItemCopy) {
            state.dragItemCopy = state.draggedItem.cloneNode(true);
            state.dragItemCopy.classList.remove(config.draggingClass);
        }
        return state.dragItemCopy;
    };

    // Снимок позиций элементов, которые могут сместиться:
    // прямые item-дети затронутых контейнеров, без перетаскиваемого элемента.
    // Анимировать всё дерево бессмысленно и дорого — двигаются только соседи.
    const captureItemRects = (containers) => {
        const rects = new Map();
        containers.forEach((container) => {
            if (!container) return;
            for (const el of container.children) {
                if (el === state.draggedItem) continue;
                if (!el.matches(config.itemSelector)) continue;
                rects.set(el, el.getBoundingClientRect());
            }
        });
        return rects;
    };

    // FLIP: инвертируем смещение и плавно возвращаем элементы на место.
    const playFlip = (rects) => {
        if (!rects || !rects.size) return;
        const duration = typeof config.animation === 'number' ? config.animation : config.animationDuration;
        const moved = [];
        rects.forEach((first, el) => {
            if (!el.isConnected) return;
            const last = el.getBoundingClientRect();
            const dx = first.left - last.left;
            const dy = first.top - last.top;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
            el.style.transition = 'none';
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            moved.push(el);
        });
        if (!moved.length) return;
        void moved[0].offsetWidth; // форсируем reflow
        requestAnimationFrame(() => {
            moved.forEach((el) => {
                el.style.transition = `transform ${duration}ms ease`;
                el.style.transform = '';
                const cleanup = () => {
                    el.style.transition = '';
                    el.style.transform = '';
                    el.removeEventListener('transitionend', cleanup);
                };
                el.addEventListener('transitionend', cleanup);
            });
        });
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
            dragItemCopy: null,
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
        if (!ghost || !ghost.parentElement) {
            state.toContainer = null;
            state.toIndex = null;
            state.position = null;
            return;
        }

        state.toContainer = ghost.parentElement;
        // Индекс считаем без перетаскиваемого элемента — это итоговый индекс после перемещения
        state.toIndex = getItemIndex(ghost.parentElement, ghost, true);
        state.position = position;
    };

    const createGhostElement = (referenceElement, position) => {
        // Нельзя класть элемент внутрь самого себя (или своего потомка) — иначе цикл в DOM
        if (referenceElement === state.draggedItem || state.draggedItem?.contains(referenceElement)) {
            return;
        }

        // Потребитель может запретить бросок в конкретный контейнер
        const targetContainer = getTargetContainer(referenceElement, position);
        if (typeof config.canDrop === 'function' && !config.canDrop(state.draggedItem, targetContainer)) {
            return;
        }

        // Цель не изменилась — не пересоздаём ghost (и не дёргаем анимацию)
        if (state.lastReference === referenceElement && state.lastPosition === position) {
            return;
        }

        // Анимируются только затронутые контейнеры: старый и новый
        const affected = state.currentDropTarget?.parentElement
            ? [state.currentDropTarget.parentElement, targetContainer]
            : [targetContainer];
        const rects = config.animation ? captureItemRects(affected) : null;

        // Индикатор создаётся один раз за перетаскивание и дальше только переносится —
        // глубокий клон поддерева на каждую смену цели не нужен.
        if (!state.currentDropTarget) {
            state.currentDropTarget = getDragClone().cloneNode(true);
            state.currentDropTarget.classList.add(config.ghostClass);
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

        if (y < rect.top + config.scrollThreshold) {
            // Scroll up
            scrollTarget.scrollTop -= config.scrollSpeed;
        } else if (y > rect.bottom - config.scrollThreshold) {
            // Scroll down
            scrollTarget.scrollTop += config.scrollSpeed;
        }
    };

    const updateDropTarget = (x, y) => {
        const elementsUnderPointer = document.elementsFromPoint(x, y)
            // ghost-элемент и клон под курсором не должны участвовать в поиске цели
            .filter(el => el !== state.ghostItem && el !== state.currentDropTarget);

        // Автоскролл ближайшего скроллируемого предка под курсором
        handleAutoScroll(elementsUnderPointer, y);

        // Один проход: ищем и элемент, и контейнер под курсором
        let itemElement = null;
        let itemContainer = null;
        for (const el of elementsUnderPointer) {
            if (!itemElement && el.matches(config.itemSelector)) itemElement = el;
            if (!itemContainer && el.matches(config.containerSelector)) itemContainer = el;
            if (itemElement && itemContainer) break;
        }

        // Проверяем элемент, на который навели, либо его родителя
        if (itemContainer && itemContainer.children.length === 0) {
            // Пустой контейнер
            createGhostElement(itemContainer, 'in')
        } else if (itemElement) {
            // Мы нашли один из элементов
            const rect = itemElement.getBoundingClientRect()
            const innerY = y - rect.top;  //y position within the element.

            if (config.debug && state.debugElement) {
                state.debugElement.style.top = `${(innerY * 100) / rect.height}%`;
            }

            // Вложенный контейнер внутри элемента — цель для зоны 'in'.
            // Курсор прямо над вложенным контейнером (а не над вложенным элементом внутри него).
            // Проверка через contains: itemContainer уже найден hit-test'ом, обход поддерева не нужен
            // и корректно работает при нескольких вложенных контейнерах в одном элементе.
            const overChildContainer = itemContainer && itemContainer !== itemElement
                && itemElement.contains(itemContainer);

            if (overChildContainer) {
                // Над вложенным контейнером — кладём внутрь
                createGhostElement(itemContainer, 'in')
            } else if (hasChildContainer(itemElement)) {
                // Три зоны: before / in / after
                const childContainer = getChildContainer(itemElement);
                const third = rect.height / 3;

                if (innerY < third) {
                    // Верхняя треть — перед элементом
                    createGhostElement(itemElement, 'before')
                } else if (innerY > third * 2) {
                    // Нижняя треть — после элемента
                    createGhostElement(itemElement, 'after')
                } else {
                    // Средняя треть — внутрь вложенного контейнера
                    createGhostElement(childContainer, 'in')
                }
            } else if (innerY * 100 < rect.height * 51) {
                // Плоский элемент: верхняя половина — before
                createGhostElement(itemElement, 'before')
            } else {
                // Плоский элемент: нижняя половина — after
                createGhostElement(itemElement, 'after')
            }
        }
    };

    // Эмитим dragOver только когда цель изменилась
    const emitDragOverIfChanged = (payload) => {
        const changed =
            state.toContainer !== state.prevToContainer ||
            state.toIndex !== state.prevToIndex ||
            state.position !== state.prevPosition;

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
        state.dragItemCopy = null;

        // Скрываем оригинальный элемент (но сохраняем его место)
        item.classList.add(config.draggingClass);

        const fromContainer = getClosestContainer(item.parentElement);
        if (fromContainer) {
            state.fromContainer = fromContainer;
            state.fromIndex = getItemIndex(fromContainer, item);
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

        dispatch('dragStart', buildPayload());
    };

    const stopDrag = () => {
        cancelFrame();

        // drop приходит ДО изменений DOM, чтобы потребитель (фреймворк) взял управление
        if (state.toContainer) {
            dispatch('drop', buildPayload());
        }

        // В режиме 'dom' модуль сам перемещает реальный элемент (обратная совместимость).
        // В режиме 'manual' реальный DOM не трогаем — порядок меняет потребитель.
        if (config.reorder === 'dom' && state.currentDropTarget?.parentNode) {
            const targetContainer = state.currentDropTarget.parentNode;
            const rects = config.animation ? captureItemRects([targetContainer]) : null;
            state.currentDropTarget.replaceWith(state.draggedItem);
            state.toContainer = state.draggedItem.parentNode;
            state.toIndex = getItemIndex(state.draggedItem.parentNode, state.draggedItem);
            if (rects) playFlip(rects);
        }

        cleanupDrag();

        dispatch('dragEnd', buildPayload());

        resetState();
    };

    // Курсор сместился от точки нажатия не меньше, чем на dragThreshold.
    const hasExceededThreshold = (x, y) =>
        Math.hypot(x - state.startX, y - state.startY) >= config.dragThreshold;

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

        dispatch('dragCancel', buildPayload());
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

            const payload = buildPayload();
            emitDragOverIfChanged(payload);
            dispatch('dragMove', payload);
        });
    };

    const onPointerDown = (e) => {
        if (config.disabled) return;

        // Если задан handleSelector — drag начинается только с ручки, иначе — с любого места элемента
        const origin = config.handleSelector
            ? e.target.closest(config.handleSelector)
            : e.target.closest(config.itemSelector);
        const item = origin?.closest(config.itemSelector);
        if (!item) return;

        // Потребитель может запретить перетаскивание конкретного элемента
        if (typeof config.canDrag === 'function' && !config.canDrag(item)) return;

        e.preventDefault();
        const { x, y } = getCoordinates(e);
        state.startX = x;
        state.startY = y;
        state.lastX = x;
        state.lastY = y;
        state.pendingItem = item;
        state.delayElapsed = false;

        state.dragDelayTimer = setTimeout(() => {
            state.delayElapsed = true;
            // Задержка истекла и порог уже пройден — стартуем сразу
            if (state.pendingItem && hasExceededThreshold(state.lastX, state.lastY)) {
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
                if (state.delayElapsed && hasExceededThreshold(x, y)) {
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
                Object.assign(config, newOptions);
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
            ...buildPayload(),
        }),

        // Прерывает перетаскивание: активное — с событием dragCancel,
        // ожидающее старта — просто отменяет отложенный запуск.
        cancel: () => {
            if (destroyed) return;
            cancelDrag();
        },
    };
}
