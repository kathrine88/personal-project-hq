// Pointer Events work with iPhone touch and a mouse. Only the handle captures
// gestures; the rest of the checklist scrolls normally. Click/keyboard opens Move.
export function attachTaskDrag(handle, row, task, move, openMove) {
  let drag = null, suppressClick = false, frame = null;
  const clearMarks = () => document.querySelectorAll('.drop-target,.drop-before').forEach(el => el.classList.remove('drop-target','drop-before'));
  function targetAt(x, y) {
    clearMarks();
    const target = document.elementFromPoint(x, y), day = target?.closest('.week-day');
    drag.day = day?.dataset.date || null; drag.before = null;
    if (!day) return;
    day.classList.add('drop-target');
    const before = [...day.querySelectorAll('.week-task:not(.is-dragging)')].find(candidate => y < candidate.getBoundingClientRect().top + candidate.getBoundingClientRect().height / 2);
    if (before) { before.classList.add('drop-before'); drag.before = before.dataset.itemKey; }
  }
  function scroll() {
    if (!drag?.active) return;
    if (drag.y < 70) window.scrollBy(0, -10);
    if (drag.y > innerHeight - 70) window.scrollBy(0, 10);
    targetAt(drag.pointerX, drag.y);
    frame = requestAnimationFrame(scroll);
  }
  function finish(event, cancel = false) {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.active && !cancel) targetAt(event.clientX, event.clientY);
    const current = drag; drag = null;
    if (frame) cancelAnimationFrame(frame);
    row.classList.remove('is-dragging'); clearMarks();
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (current.active) {
      suppressClick = true;
      if (!cancel && current.day) move(task, current.day, current.before).catch(() => {});
    }
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    suppressClick = false;
    drag = { id:event.pointerId, x:event.clientX, pointerX:event.clientX, y:event.clientY, initialY:event.clientY, active:false, day:null, before:null };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    drag.y = event.clientY; drag.pointerX = event.clientX;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.initialY) > 7) {
      drag.active = true; row.classList.add('is-dragging'); frame = requestAnimationFrame(scroll);
    }
    if (!drag.active) return;
    event.preventDefault(); targetAt(event.clientX, event.clientY);
  }, { passive:false });
  handle.addEventListener('pointerup', event => finish(event));
  handle.addEventListener('pointercancel', event => finish(event, true));
  handle.addEventListener('lostpointercapture', event => finish(event, true));
  handle.addEventListener('click', event => { if (suppressClick) { suppressClick = false; event.preventDefault(); } else openMove(task); });
}
