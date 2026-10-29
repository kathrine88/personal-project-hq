// Touch Events let Safari keep native scrolling until the hold is armed, then
// cancel scrolling for that gesture. Changing touch-action after pointerdown
// cannot do this reliably. Pointer Events handle mouse/pen; controls are excluded.
export const TASK_HOLD_MS = 320;
const SLOP = 8;
export function attachTaskDrag(handle, row, task, move, openMove) {
  let gesture = null, timer = null, frame = null, preview = null, suppressUntil = 0;
  const marks = () => document.querySelectorAll('.drop-target,.drop-before,.drop-end').forEach(el => el.classList.remove('drop-target','drop-before','drop-end'));
  const control = target => target.closest('input,button,a,select,textarea,[contenteditable="true"],[role="button"]:not(.week-task-name-drag)');
  function targetAt(x, y) {
    marks();
    const day = document.elementFromPoint(x, y)?.closest('.week-day');
    gesture.day = day?.dataset.date || null; gesture.before = null;
    if (!day) return;
    day.classList.add('drop-target');
    const before = [...day.querySelectorAll('.week-task:not(.is-dragging)')].find(candidate => y < candidate.getBoundingClientRect().top + candidate.getBoundingClientRect().height / 2);
    if (before) { before.classList.add('drop-before'); gesture.before = before.dataset.itemKey; }
    else day.classList.add('drop-end');
  }
  function feedback() {
    if (!gesture?.active) return;
    if (!row.isConnected) { finish(true); return; }
    preview.style.transform = `translate3d(${gesture.x - gesture.originX}px,${gesture.y - gesture.originY - 3}px,0) scale(1.02)`;
    targetAt(gesture.x, gesture.y);
  }
  function scroll() {
    if (!gesture?.active) return;
    if (gesture.y < 70) window.scrollBy(0, -10);
    if (gesture.y > innerHeight - 70) window.scrollBy(0, 10);
    feedback();
    if (gesture?.active) frame = requestAnimationFrame(scroll);
  }
  function escape(event) { if (event.key === 'Escape') { event.preventDefault(); finish(true); } }
  function activate() {
    if (!gesture || !row.isConnected) { finish(true); return; }
    gesture.active = true;
    const rect = row.getBoundingClientRect();
    preview = row.cloneNode(true); preview.classList.add('drag-preview'); preview.setAttribute('aria-hidden','true'); preview.inert = true;
    preview.removeAttribute('id'); preview.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    Object.assign(preview.style, { left:`${rect.left}px`, top:`${rect.top}px`, width:`${rect.width}px` });
    document.body.append(preview); row.classList.add('is-dragging');
    if (gesture.kind === 'pointer' && !handle.hasPointerCapture(gesture.id)) row.setPointerCapture(gesture.id);
    document.addEventListener('keydown', escape);
    feedback(); frame = requestAnimationFrame(scroll);
  }
  function start(kind, id, x, y, immediate) {
    suppressUntil = 0;
    gesture = { kind, id, x, y, originX:x, originY:y, active:false, moved:false, immediate, day:null, before:null };
    if (!immediate) timer = setTimeout(activate, TASK_HOLD_MS);
  }
  function update(x, y, event) {
    if (!gesture) return;
    gesture.x = x; gesture.y = y;
    if (!gesture.active && Math.hypot(x - gesture.originX, y - gesture.originY) > SLOP) {
      if (gesture.immediate) activate();
      else { finish(true); return; } // Swiping before the hold scrolls normally.
    }
    if (gesture?.active) { gesture.moved = true; if (event.cancelable) event.preventDefault(); feedback(); }
  }
  function finish(cancel = false) {
    if (!gesture) return;
    const current = gesture; gesture = null;
    clearTimeout(timer); timer = null; cancelAnimationFrame(frame); frame = null;
    preview?.remove(); preview = null; row.classList.remove('is-dragging'); marks();
    document.removeEventListener('keydown', escape);
    if (current.kind === 'pointer') {
      if (row.hasPointerCapture(current.id)) row.releasePointerCapture(current.id);
      if (handle.hasPointerCapture(current.id)) handle.releasePointerCapture(current.id);
    }
    if (current.active) {
      // Prevent the synthetic click from toggling the label's checkbox on drop.
      suppressUntil = performance.now() + 500;
      if (!cancel && current.day && current.moved) move(task, current.day, current.before).catch(() => {});
    }
  }
  row.addEventListener('touchstart', event => {
    if (gesture || event.touches.length !== 1) { finish(true); return; }
    const onHandle = handle.contains(event.target);
    if (control(event.target) && !onHandle) return;
    const touch = event.changedTouches[0]; start('touch', touch.identifier, touch.clientX, touch.clientY, onHandle);
  }, { passive:true });
  row.addEventListener('touchmove', event => {
    if (gesture?.kind !== 'touch') return;
    if (event.touches.length !== 1) { finish(true); return; }
    const touch = [...event.touches].find(t => t.identifier === gesture.id);
    if (touch) update(touch.clientX, touch.clientY, event);
  }, { passive:false });
  row.addEventListener('touchend', event => {
    if (gesture?.kind !== 'touch') return;
    if (event.touches.length) { finish(true); return; }
    const touch = [...event.changedTouches].find(t => t.identifier === gesture.id);
    if (!touch) return;
    if (gesture.active) { if (event.cancelable) event.preventDefault(); targetAt(touch.clientX, touch.clientY); }
    finish();
  }, { passive:false });
  row.addEventListener('touchcancel', () => finish(true));
  row.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || event.button !== 0 || gesture) return;
    const onHandle = handle.contains(event.target);
    if (control(event.target) && !onHandle) return;
    start('pointer', event.pointerId, event.clientX, event.clientY, onHandle);
    if (onHandle) handle.setPointerCapture(event.pointerId);
  });
  row.addEventListener('pointermove', event => { if (gesture?.kind === 'pointer' && gesture.id === event.pointerId) update(event.clientX, event.clientY, event); });
  row.addEventListener('pointerup', event => {
    if (gesture?.kind !== 'pointer' || gesture.id !== event.pointerId) return;
    if (gesture.active) { event.preventDefault(); targetAt(event.clientX, event.clientY); }
    finish();
  });
  row.addEventListener('pointerleave', () => { if (gesture?.kind === 'pointer' && !gesture.active) finish(true); });
  row.addEventListener('pointercancel', event => { if (gesture?.kind === 'pointer' && gesture.id === event.pointerId) finish(true); });
  row.addEventListener('lostpointercapture', event => { if (gesture?.kind === 'pointer' && gesture.id === event.pointerId) finish(true); });
  row.addEventListener('contextmenu', event => { if (!control(event.target) || handle.contains(event.target)) event.preventDefault(); });
  row.addEventListener('click', event => {
    if (performance.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  handle.addEventListener('click', () => openMove(task));
}
