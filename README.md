# Drag-n-sort native JS module

A lightweight, high-performance, and configurable drag and drop library built with pure JavaScript,
no dependencies required. It supports nested containers, touch devices, auto-scroll, FLIP animation
and both DOM-owning and framework-driven (Vue/React) reordering.

[Demo](https://downtest.github.io/)

## Installation

### NPM
```bash
npm install native-drag-n-sort
```

### Yarn
```bash
yarn add native-drag-n-sort
```

## How it works

`dragNDrop(options)` is a factory: it finds the container, injects the required styles and attaches
listeners, then returns a small API object. All state lives in a closure — you can create several
independent instances on the same page.

### 1. Initialization

- The container is resolved once via `containerSelector` (`document.querySelector`). If it is not
  found, the factory returns `undefined`.
- A `<style>` block is injected into `<head>` using the configured `cloneClass`, `draggingClass` and
  `ghostClass`. The clone follows the cursor (`position: fixed`), the original is hidden
  (`display: none`) and the drop indicator is semi-transparent. Both the clone and the indicator get
  `pointer-events: none` so they never interfere with hit-testing.
- Styles are shared across instances: a module-level registry injects each unique style block only
  **once**, no matter how many instances use the same class names. The block is removed when the last
  instance that uses it is destroyed. So 10 instances with the same config produce a single `<style>`
  in `<head>`.
- `mousedown` / `touchstart` are attached to the container; `mousemove` / `touchmove` and
  `mouseup` / `touchend` / `touchcancel` — to `document` (so a drag keeps working outside the
  container).

### 2. Starting a drag

On pointer down the module:

1. Resolves the item: from `handleSelector` if set, otherwise from `itemSelector`.
2. Calls `canDrag(item)` — if it returns `false`, the drag is not started.
3. Records the start point and starts a `dragDelay` timer.

The drag actually begins when **both** conditions are met:

- `dragDelay` has elapsed, **and**
- the pointer has moved at least `dragThreshold` pixels from the start point.

This lets a quick, confident movement start the drag without waiting for the full delay, while a
simple click never triggers it.

### 3. While dragging

- The original element gets `draggingClass` (hidden, but its place in the layout is preserved).
- A clone of the item (`cloneClass`) is appended to `<body>` and follows the cursor.
- On every pointer move the module computes the element under the cursor with
  `document.elementsFromPoint` and decides the drop position:
  - **empty container** → `in`;
  - **item with a nested container** → three zones: top third `before`, middle third `in` (into the
    nested container), bottom third `after`;
  - **flat item** → top half `before`, bottom half `after`.
- A drop indicator (`ghostClass`) is inserted at the computed position. It is only recreated when the
  target actually changes, so the DOM is not touched on every move.
- Auto-scroll kicks in near the edges of the scroll container (see `scrollContainer`).
- Movement is throttled with `requestAnimationFrame`: at most one target recalculation and one
  `dragMove` event per frame.

### 4. Dropping

On pointer up the module:

1. Emits `drop` **before** touching the DOM, so a framework can take over.
2. In `reorder: 'dom'` mode it replaces the indicator with the real element (applying the new
   order) and, if `animation` is enabled, plays a FLIP animation.
3. Removes the clone and the indicator, restores the original element and emits `dragEnd`.

`cancel()` aborts the drag at any moment without applying changes and emits `dragCancel`.

### Events flow

```
pointerdown ──► (dragDelay + dragThreshold) ──► dragStart
pointermove ──► dragMove (per frame) ──► dragOver (only when the target changes)
pointerup   ──► drop ──► [DOM update in 'dom' mode] ──► dragEnd
cancel()    ──► dragCancel
```

# Configuration Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| **containerSelector** | `string` | `'.container'` | CSS selector for the container element that holds sortable items |
| **itemSelector** | `string` | `'.item'` | CSS selector for draggable/sortable items within the container |
| **handleSelector** | `string` \| `null` | `null` | CSS selector for drag handle element. If null, the entire item is draggable |
| **ghostClass** | `string` | `'item-ghost'` | CSS class applied to the drop position indicator element |
| **draggingClass** | `string` | `'item-dragging'` | CSS class applied to the original element during dragging |
| **cloneClass** | `string` | `'item-clone'` | CSS class applied to the element that follows the cursor |
| **dragDelay** | `number` | `100` | Delay in milliseconds before a drag can start. The drag begins once this delay has elapsed **and** the pointer has moved by `dragThreshold` |
| **scrollSpeed** | `number` | `10` | Scroll step in pixels applied on each frame while dragging near the edges of the scroll container |
| **scrollThreshold** | `number` | `50` | Distance from the scroll container edge in pixels that triggers auto-scrolling |
| **dragThreshold** | `number` | `5` | Minimum cursor movement in pixels before a drag starts. The drag begins once both `dragDelay` has elapsed and the pointer has moved at least this far |
| **debug** | `boolean` | `false` | Shows a debug overlay with the cursor level inside the hovered item |
| **reorder** | `'dom'` \| `'manual'` | `'dom'` | Who applies the new order. `'dom'` — the module moves the real element (backward compatible). `'manual'` — the module never touches the real DOM; the consumer (e.g. Vue) applies the order from the event payload |
| **getItemId** | `(el) => any` | `el => el?.dataset?.id ?? null` | Maps a DOM item to a serializable id used in event payloads |
| **getContainerId** | `(el) => any` | `el => el?.dataset?.id ?? el?.dataset?.containerId ?? null` | Maps a DOM container to a serializable id used in event payloads |
| **disabled** | `boolean` | `false` | Fully disables dragging. Can be toggled at runtime via `refresh({ disabled })` |
| **canDrag** | `(el) => boolean` \| `null` | `null` | Predicate called before a drag starts. Return `false` to prevent dragging the given item |
| **canDrop** | `(el, target) => boolean` \| `null` | `null` | Predicate called for each candidate drop target. Return `false` to forbid dropping the dragged item into `target` |
| **animation** | `boolean` \| `number` | `false` | Enables FLIP animation of the reordering. `true` uses `animationDuration`; a number sets the duration in ms |
| **animationDuration** | `number` | `200` | FLIP animation duration in ms (used when `animation === true`) |
| **scrollContainer** | `string` \| `Element` \| `null` | `null` | Explicit scroll container (CSS selector or element) for auto-scroll. When `null`, the nearest scrollable ancestor under the cursor is used |

## Public API

`dragNDrop(options)` returns an object with the following methods:

| Method | Description |
|--------|-------------|
| **destroy()** | Removes all event listeners and injected styles, and cancels any active drag. Call it on unmount |
| **refresh(newOptions?)** | Re-reads the container (after a re-render) and optionally merges `newOptions` into the config. Useful to toggle `disabled` or update predicates at runtime |
| **getState()** | Returns a serializable snapshot: `{ isDragging, itemId, fromContainerId, fromIndex, toContainerId, toIndex, position }` |
| **cancel()** | Aborts the current drag without applying any changes and emits `dragCancel` |

## Events

All events are dispatched on the container element and carry a serializable `detail` payload
(no DOM node references). Subscribe with `addEventListener`.

| Event | When | Payload |
|-------|------|---------|
| **dragStart** | Drag has started | `{ itemId, fromContainerId, fromIndex, toContainerId, toIndex, position }` |
| **dragMove** | While dragging, throttled to one event per animation frame | same payload |
| **dragOver** | Only when the drop target changes (container / index / position) | same payload |
| **drop** | On release, **before** the DOM is modified | same payload |
| **dragEnd** | Drag finished (after the DOM is updated in `'dom'` mode) | same payload |
| **dragCancel** | Drag aborted via `cancel()` | same payload |

### Payload fields

| Field | Type | Description |
|-------|------|-------------|
| **itemId** | `any` | Id of the dragged item (via `getItemId`) |
| **fromContainerId** | `any` | Id of the source container (via `getContainerId`) |
| **fromIndex** | `number` \| `null` | Index of the item in the source container |
| **toContainerId** | `any` \| `null` | Id of the target container |
| **toIndex** | `number` \| `null` | Final index of the item in the target container |
| **position** | `'before'` \| `'after'` \| `'in'` \| `null` | Drop position relative to the reference element |

## Usage example
#### Html
```html
<div class="container">
    <div class="item">
        <div class="item--title">First</div>
        <div class="item--children container"></div>
    </div>
    <div class="item">
        <div class="item--title">Second</div>
        <div class="item--children container">
            <div class="item">
                <div class="item--title">Sub-First</div>
                <div class="item--children container"></div>
            </div>
            <div class="item">
                <div class="item--title">Sub-Second</div>
                <div class="item--children container"></div>
            </div>
            <div class="item">
                <div class="item--title">Sub-Third</div>
                <div class="item--children container"></div>
            </div>
        </div>
    </div>
    <div class="item">
        <div class="item--title">Third</div>
        <div class="item--children container"></div>
    </div>
</div>
```

#### JS
```js
import dragNDrop from 'native-drag-n-sort';

const dragManager = dragNDrop({
    containerSelector: '.container',
    itemSelector: '.item',
    ghostClass: 'item-ghost',
    draggingClass: 'item-dragging',
    // handleSelector: '.item-handle',
    dragDelay: 150,
    animation: false,
});

// Подписка на события
const container = document.querySelector('.container');
container.addEventListener('dragStart', (e) => {
    console.log('Drag started', e.detail);
});
container.addEventListener('dragEnd', (e) => {
    console.log('Drag ended', e.detail);
});

// Позже, при размонтировании:
// dragManager.destroy();
```

## Manual reorder mode

By default (`reorder: 'dom'`) the module moves the real element itself — this is fully backward
compatible. For frameworks that own the DOM (Vue, React, etc.) use `reorder: 'manual'`: the module
never mutates the real DOM and instead reports the intended change through the `drop` event, so the
consumer can apply it to its own data model.

```js
const dragManager = dragNDrop({
    containerSelector: '.container',
    itemSelector: '.item',
    reorder: 'manual',
    getItemId: (el) => el.dataset.id,
    getContainerId: (el) => el.dataset.id,
});

document.querySelector('.container').addEventListener('drop', (e) => {
    const { itemId, fromContainerId, fromIndex, toContainerId, toIndex } = e.detail;
    // Применяем изменение к данным, а не к DOM
    applyMove({ itemId, fromContainerId, fromIndex, toContainerId, toIndex });
});
```

## Vue 3 integration

```vue
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import dragNDrop from 'native-drag-n-sort';

const list = ref([
    { id: 'a', title: 'First' },
    { id: 'b', title: 'Second' },
    { id: 'c', title: 'Third' },
]);

const containerRef = ref(null);
let manager = null;

const onDrop = (e) => {
    const { fromIndex, toIndex } = e.detail;
    if (fromIndex === toIndex || toIndex == null) return;

    const next = [...list.value];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    list.value = next;
};

onMounted(() => {
    manager = dragNDrop({
        containerSelector: '.container',
        itemSelector: '.item',
        reorder: 'manual', // Vue владеет DOM — модуль только сообщает о намерении
        animation: true,
        getItemId: (el) => el.dataset.id,
        getContainerId: (el) => el.dataset.id,
    });
    containerRef.value.addEventListener('drop', onDrop);
});

onBeforeUnmount(() => {
    containerRef.value?.removeEventListener('drop', onDrop);
    manager?.destroy();
});
</script>

<template>
    <div ref="containerRef" class="container">
        <div v-for="item in list" :key="item.id" class="item" :data-id="item.id">
            {{ item.title }}
        </div>
    </div>
</template>
```
