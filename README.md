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

## Running the demo locally

The demo must be served over `http`, not opened from the file system: it loads `index.js` as an ES
module, and browsers block module imports from `file://` with a CORS error
(`Access to script at 'file:///…/index.js' from origin 'null' has been blocked by CORS policy`).

```bash
npm run demo          # node demo/server.cjs, http://localhost:8080/
PORT=3000 npm run demo
```

Or with Docker (the same server, published on `http://localhost:8080/`):

```bash
docker compose up
```

The demo page has buttons for `reorder: 'manual'`, `animation` and `cancel()`, a nested list, a flat
list, and an event log, so every public API path can be exercised by hand.

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
- Styles are shared across instances: a per-document registry injects each unique style block only
  **once**, no matter how many instances use the same class names. The block is removed when the last
  instance that uses it is destroyed. So 10 instances with the same config produce a single `<style>`
  in `<head>`.
- `mousedown` / `touchstart` are attached to the container; `mousemove` / `touchmove` and
  `mouseup` / `touchend` — to `document` (so a drag keeps working outside the container).
  `touchcancel` aborts the drag instead of dropping: the browser took the gesture, so moving the
  item would be wrong.

### 2. Starting a drag

On pointer down the module:

1. Resolves the item: from `handleSelector` if set, otherwise from `itemSelector`.
2. Calls `canDrag(item)` — if it returns `false`, the drag is not started.
3. Records the start point and starts a `dragDelay` timer.

The drag actually begins when **both** conditions are met:

- `dragDelay` has elapsed, **and**
- the pointer has moved at least `dragThreshold` pixels from the start point.

Both conditions are required: a long press without movement does not start a drag, and a quick
movement starts it only after `dragDelay`. Together they filter out accidental drags on clicks,
selection and scrolling.

### 3. While dragging

- The original element gets `draggingClass` (hidden, but its place in the layout is preserved).
- A clone of the item (`cloneClass`) is appended to `<body>` and follows the cursor.
- On every pointer move the module computes the element under the cursor with
  `document.elementsFromPoint` and decides the drop position:
  - **empty container** → `in`;
  - **item with a nested container** → three zones: top third `before`, middle third `in` (into the
    nested container), bottom third `after`;
  - **flat item** → top half `before`, bottom half `after`;
  - **gap between items** (the cursor is over the container, not over an item) → `before` the first
    item whose top is below the cursor. Below the last item it falls back to `in`, which gives the
    same index at the end of the list. This keeps the indicator stable: treating a gap as "append
    to the container" made it jump to the end and back on lists with `gap`, which looked like
    flickering between the 2nd and 3rd position.
- Geometry is always measured with the indicator **removed from the DOM** (not just hidden with
  `display: none`): a hidden node is still a child, so selectors like `.children:empty` stop
  matching, an empty list with padding stretches its parent, the cursor falls into another zone and
  the indicator jumps back. Removing the node keeps every layout query identical to the layout the
  user actually sees, so a decision never depends on its own previous result (no feedback loop,
  no flicker).
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

`cancel()` aborts the drag at any moment: an active drag is rolled back and emits `dragCancel`, a
drag that has not started yet is cancelled silently.

### Events flow

```
pointerdown ──► (dragDelay + dragThreshold) ──► dragStart
pointermove ──► dragMove (per frame) ──► dragOver (only when the target changes)
pointerup   ──► drop ──► [DOM update in 'dom' mode] ──► dragEnd
cancel()    ──► dragCancel (only if the drag has already started)
```

### Several instances on one page

Instances are independent: each has its own state, container and listeners. Styles are shared —
the module keeps a registry of injected `<style>` blocks, keyed by the class names, so 10 instances
with the same `ghostClass` / `draggingClass` / `cloneClass` produce a single `<style>` in `<head>`.
The block is removed when the last instance that uses it is destroyed.

```js
const left = dragNDrop({ containerSelector: '#left', itemSelector: '.item' });
const right = dragNDrop({ containerSelector: '#right', itemSelector: '.item' });
// one shared <style> in <head>
left.destroy();  // style stays: `right` still uses it
right.destroy(); // style removed
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
| **debug** | `boolean` | `false` | Shows a per-instance debug overlay with the cursor level inside the hovered item. The overlay markup has no fixed `id`, so several debug instances can coexist. Can be toggled at runtime via `refresh({ debug })` |
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
| **destroy()** | Removes all event listeners, cancels any active drag and releases this instance's reference to the injected styles. Styles are actually removed from `<head>` only when the last instance using them is destroyed. Safe to call more than once |
| **refresh(newOptions?)** | Re-reads the container (after a re-render) and optionally merges `newOptions` into the config. If `ghostClass` / `draggingClass` / `cloneClass` or `debug` changed, the injected styles and the debug overlay are rebuilt to match |
| **getState()** | Returns a serializable snapshot: `{ isDragging, itemId, fromContainerId, fromIndex, toContainerId, toIndex, position }` |
| **cancel()** | Aborts the drag. An active drag is cleaned up and emits `dragCancel`; a pending drag (still waiting for `dragDelay` / `dragThreshold`) is simply cancelled without any event |

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
| **dragCancel** | Drag aborted via `cancel()` while active | same payload |

> `cancel()` called before the drag has started (during `dragDelay`) emits nothing.

### Payload fields

| Field | Type | Description |
|-------|------|-------------|
| **itemId** | `any` | Id of the dragged item (via `getItemId`) |
| **fromContainerId** | `any` | Id of the source container (via `getContainerId`) |
| **fromIndex** | `number` \| `null` | Index of the item in the source container |
| **toContainerId** | `any` \| `null` | Id of the target container |
| **toIndex** | `number` \| `null` | Final index of the item in the target container |
| **position** | `'before'` \| `'after'` \| `'in'` \| `null` | Drop position relative to the reference element |

## Robustness

The module never leaves a half-finished drag behind, and never fails silently on a bad config.

- **Invalid selectors** — `containerSelector`, `itemSelector`, `handleSelector` and a string
  `scrollContainer` are checked on creation (and again in `refresh()` when the value changes).
  A typo throws a `TypeError` naming the option instead of a bare `DOMException` from
  `querySelector`:

  ```js
  dragNDrop({ containerSelector: '(((' });
  // TypeError: [native-drag-n-sort] containerSelector is not a valid CSS selector: "((("
  ```

- **Non-numeric options** — `NaN`, `Infinity`, strings and negative values in `dragDelay`,
  `dragThreshold`, `scrollSpeed`, `scrollThreshold` and `animationDuration` fall back to the
  defaults (negatives are clamped to `0`). Without this, `dragThreshold: NaN` would make the
  threshold comparison always `false` and drag would silently never start. An unknown `reorder`
  value falls back to `'dom'`.
- **Throwing callbacks** — an exception in `getItemId` / `getContainerId` yields `null` for that
  field, in `canDrag` it blocks the drag, in `canDrop` it forbids the drop. The error is reported
  with `console.error` and the drag continues.
- **Failing event dispatch** — if dispatching `dragStart` throws, the drag is rolled back (clone,
  indicator and `draggingClass` are removed). `drop` / `dragEnd` are wrapped in `try/finally`, so
  the clone, the indicator and `isDragging` are always cleaned up even when a consumer listener
  throws.
- **Stable drop indicator** — the target is computed with the indicator temporarily removed from the
  DOM, so the next decision never depends on the previous one. Gaps between items resolve to "before
  the next item" instead of "append to the container". Both were visible as flicker: the indicator
  jumped to the end of a nested list and back, and jittered on the top third of an item while the
  cursor moved smoothly.
- **Styles per document** — the style registry is keyed by `document`, so instances in different
  documents (an iframe, or several jsdom instances in tests) never share a `<style>` element.
- **Large lists** — a drag frame must not walk the whole list. Item children are collected once per
  drag and cached (invalidated when the child count changes), the insertion point between items is
  found by binary search when the layout is monotonic, and FLIP captures rects only for rows inside
  the viewport. `test/scale.test.mjs` locks this in by counting `getBoundingClientRect` and
  `matches` calls per frame.

### How far it scales

The library does not hide rows, so every item is a real layout box. Moving the drop indicator
inserts a node into that flow, and the browser must lay the whole container out again before any
geometry can be read. That cost is linear in the number of items and belongs to the browser, not to
this module — no amount of caching on our side removes it.

Measured in Chromium (1280×800, DPR 1.25, cursor moved once per frame, 120 frames, animation on):

| Items | Our work per frame (p50) | Frame time (p50) | Frames >20 ms |
|---|---|---|---|
| 1000 | 2.9 ms | 16.6 ms | 1/120 |
| 5000 | 12.0 ms | 25.8 ms | 116/120 |
| 10000 | 24.0 ms | 48.9 ms | 119/120 |

Of the 24 ms at 10 000 items, ~19 ms is a single `elementsFromPoint` call that has to flush the
layout after the indicator moved; the rest is rect reads for the visible rows plus the animations.

**Practical limit: ~1000–2000 items per container.** Up to that the drag holds 60 fps with margin.
Above it the list still works correctly, but frames get longer and the motion visibly stutters.

If you need smooth dragging in a longer list, keep the DOM small — render only the rows in view
(virtual list). With, say, 50 mounted rows the reflow above costs the same as it does for a 50-item
list, and the library's own cost stays flat. Virtualisation has to keep the rows' order and the
container's geometry stable; the library itself does not care how the items got there.

## Testability

The single file also exposes its pure helpers as named exports. They do not read module state and
do not touch the DOM on their own — every dependency (`document`, `matches`, `querySelector`,
`getBoundingClientRect`, `cloneNode`, `getItemId`) is injected, so they can be unit-tested in
isolation. The default export is unchanged.

```js
import dragNDrop, { getScrollDelta, resolveDropZone } from 'native-drag-n-sort';

getScrollDelta({ y: 5, top: 0, bottom: 300, threshold: 50, speed: 10 }); // -10
resolveDropZone({ innerY: 150, height: 300, hasChildContainer: true });  // 'in'
```

Available: `DEFAULTS`, `REORDER_MODES`, `SCROLLABLE_OVERFLOW`, `DEBUG_STYLE_SIGNATURE`,
`VIEWPORT_MARGIN`, `toFiniteNumber`, `normalizeOptions`, `assertSelectorSyntax`, `createStyleCss`,
`createDebugCss`, `createStyleRegistry`, `createItemClassifier`, `createChildContainerResolver`,
`collectItems`, `getItemIndex`, `resolveDropZone`, `resolveContainerInsertion`,
`isMonotonicLayout`, `detachGhost`, `getTargetContainer`, `hasExceededThreshold`, `buildPayload`,
`shouldEmitDragOver`, `isScrollableStyle`, `getScrollDelta`, `getCoordinates`,
`createDragCloneCache`, `visibleChildRange`, `captureRects`, `computeFlipTransforms`.

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

## Performance notes

Deeply nested lists are the expensive case: the module must find the drop target and keep the
ghost indicator in sync on every frame. The hot path is kept allocation-free:

- **Child container lookup** — `item.querySelector(containerSelector)` is cached in a `WeakMap`
  keyed by the item element, so the subtree is walked once per item instead of once per frame.
- **Drag clone** — the deep clone of the dragged item is created once per drag (`state.dragItemCopy`)
  and reused both for the cursor ghost and for the drop indicator. Cloning a large subtree on every
  drop-target change was the main cost in nested lists.
- **Drop indicator** — created once per drag and then only moved (`appendChild`/`before`/`after`),
  never re-created. Moving a node does not invalidate the rest of the document.
- **FLIP animation** — played through the Web Animations API (`element.animate`), so no forced
  reflow is needed to "enable" the inversion and no inline styles or `transitionend` handlers are
  left behind. The previous animation of the same element is cancelled first, otherwise one
  `Animation` object per frame piles up in the compositor. `getBoundingClientRect` is read only for
  the item children of the containers that actually change (previous target and next target), and
  only for rows inside the viewport, not for the whole tree.
- **Auto-scroll** — the scroll container and its `getBoundingClientRect` are cached and re-measured
  only when `scrollTop` changed.
- **Move throttling** — pointer moves are coalesced into one `requestAnimationFrame` pass; identical
  coordinates are skipped, so a burst of `mousemove` events costs a single layout query.

## Tests

The test suite runs the real module against a jsdom document with a hand-rolled layout, so it
exercises exactly what a user does: press the mouse, wait for `dragDelay`, move, release.

```bash
npm test          # node --test --test-concurrency=1 "test/*.test.mjs"
```

The suite has two layers:

- **Unit tests** (`test/internals.test.mjs`) — every exported pure helper on its own, with several
  datasets and mocked neighbours, so a failure points at one function. `createItemClassifier` is
  tested with a counting `matches` mock, `captureRects` with a `getRect` mock, the style registry
  with a fake document, `getScrollDelta` / `resolveDropZone` / `hasExceededThreshold` with edge
  values, and so on.
- **Behaviour tests** — the factory driven by real DOM events and a mouse/touch emulator.
  `test/helpers.mjs` provides the jsdom setup, manual layout (`layout(el, box)`),
  `elementsFromPoint` hit-testing, `getBoundingClientRect` from the layout, deterministic
  `requestAnimationFrame` with `flushFrames()`, a mouse emulator (`down`/`move`/`up`) and a touch
  emulator (`start`/`move`/`end`/`cancel`).

| File | Focus |
|------|-------|
| `test/internals.test.mjs` | Pure helpers in isolation: options normalisation, selector validation, style registry and CSS, caches, indices, drop zones, thresholds, payload, scroll deltas, coordinates, clone cache, FLIP math |
| `test/drag.test.mjs` | Flat lists: styles/API, `dragDelay` + `dragThreshold` start conditions, clone position and content, `draggingClass`, before/after insertion, event sequence, repeated drags, `cancel()`, `reorder: 'manual'`, `canDrag`, `handleSelector`, `disabled` |
| `test/ux.test.mjs` | User experience end to end: lists unchanged during the drag, the original hidden in place, the ghost sitting exactly where the item will land, the item disappearing from the old list and appearing at the ghost's position, payload correctness, ghost moving between lists, cancel restoring everything, `manual` mode, `dragOver` only on real changes, slow drags (one `dragMove` per frame), fast drags (coalesced), a jump straight to the target, a drop into an empty list, custom classes with a handle |
| `test/nested.test.mjs` | Nested lists: `before`/`in`/`after` zones, dropping into a child container, moving between levels in both directions, rejecting a drop into the dragged element's own subtree, `canDrop`, a four-level-deep tree |
| `test/lifecycle.test.mjs` | Side effects and cleanup: shared `<style>` across instances, custom classes, idempotent `destroy()`, `destroy()` during a drag, `refresh()`, debug overlay, touch drag (including `touchcancel`), release outside the list, auto-scroll, `dragMove` throttling |
| `test/regressions.test.mjs` | Previously broken paths: throwing `getItemId`/`canDrag`/`canDrop`, failing `dragStart` dispatch, a throwing `drop` listener, invalid selectors (including through `refresh()`), `NaN`/negative/infinite thresholds, unknown `reorder`, DOM node returned from `getItemId`, two instances on one container |
| `test/perf.test.mjs` | The hot path is asserted by counting expensive operations instead of measuring time: the deep clone happens at most 3 times per drag, and each item's child container is looked up at most once |
| `test/target-data.test.mjs` | Correctness of the data a consumer receives: `fromContainerId`, `toIndex` inside the *target* container (including an empty one), `data-container-id` fallback, a nested container rendered between two drags, ignoring the secondary mouse button |
| `test/animation.test.mjs` | FLIP through the Web Animations API: neighbours get an inverted `translate` keyframe back to `translate(0px, 0px)` with the configured duration and `fill: 'none'`, no inline styles are left behind, the previous animation is cancelled, a numeric `animation` sets the duration, and a missing `animate` is tolerated |
| `test/edge-cases.test.mjs` | Early exits and recovery: no container, drop outside the list, start driven by the `dragDelay` timer, `containerSelector` swapped through `refresh()`, debug overlay toggled at runtime, cancelling a scheduled frame, reusing the indicator while the target is unchanged, restoring it after a consumer re-render, `cancel()`/`refresh()` after `destroy()` |
| `test/flicker.test.mjs` | Indicator stability: a gap between items resolves to `before` the next item (not "append"), below the last item still appends, the third item becomes second while the cursor is on the second item, a smooth 1px sweep up and down produces no `A → B → A` target changes, the result does not depend on the side the cursor entered from, and layout is measured with the indicator removed from the DOM (so `:empty`-based styles keep working) |

Coverage (`node --test --experimental-test-coverage`): **99.6% lines, 96.9% branches, 100% functions**
for `index.js`. The remaining uncovered lines are the "indicator was removed by a consumer
re-render" guard in `updateTargetData`, which no public API path reaches on its own.

Run them after every change: a broken start condition (drag never begins) or a broken finish
condition (release does not complete the drag) fails the corresponding test immediately.
