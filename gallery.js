/* A shared gallery for Themes and the standalone KNOTATION project.
   Paused MP4 turntables respond only to input; wheel movement eases to a stop. */
(() => {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pingPong = (phase, end) => {
    if (!(end > 0)) return 0;
    const p = ((phase % (2 * end)) + 2 * end) % (2 * end);
    return p <= end ? p : 2 * end - p;
  };
  window.createBraceletGallery = ({ root, relationships, sourceCards = [] }) => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const stage = document.createElement('div');
    stage.className = 'space-stage';
    stage.tabIndex = 0;
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-label', 'Floating bracelet gallery. Drag a four-way arrow to move its bracelet. Click an edge arrow to bring that bracelet back into view. Drag or scroll a bracelet to rotate it. Drag empty space to move all bracelets; press R to reset their positions.');
    const labelLayer = document.createElement('div');
    labelLayer.className = 'space-label-layer';
    labelLayer.setAttribute('aria-hidden', 'true');
    const handleLayer = document.createElement('div');
    handleLayer.className = 'space-handle-layer';
    stage.append(labelLayer, handleLayer);
    const announcement = document.createElement('p');
    announcement.className = 'visually-hidden'; announcement.setAttribute('role', 'status');
    root.append(stage, announcement);
    // Flat collage: fixed sizes and brightness, with independent drifting paths.
    // There is no perspective, camera orbit, or depth-based scaling.
    const layout = [
      [.18, .20, 1.12], [.51, .14, .92], [.90, .20, .94],
      [.08, .57, .88], [.49, .51, 1.05], [.88, .60, 1.03],
      [.26, .88, 1.02], [.58, .88, .90], [.95, .91, .98], [.30, .56, .91], [.72, .34, .94], [.62, .70, .90]
    ];
    let active = false, transitioning = false, raf = 0, previous = 0;
    let drag = null, panX = 0, panY = 0, targetPanX = 0, targetPanY = 0;
    const entries = relationships.map((relation, index) => {
      const source = sourceCards[index];
      const video = source?.querySelector('video') || document.createElement('video');
      if (!source) {
        video.muted = true; video.playsInline = true; video.preload = 'auto';
        video.autoplay = false; video.controls = false; video.tabIndex = -1;
        video.setAttribute('aria-hidden', 'true');
        const videoVersion = relation.braceletVersion
          ? `?v=${encodeURIComponent(relation.braceletVersion)}`
          : "";
        video.src = `assets/${encodeURIComponent(relation.bracelet)}${videoVersion}`;
        video.addEventListener('play', () => video.pause());
      }
      const object = document.createElement('div'); object.className = 'space-object';
      object.dataset.relationship = relation.id;
      const turntable = document.createElement('button');
      turntable.className = 'space-turntable'; turntable.type = 'button';
      turntable.setAttribute('aria-label', `${relation.name} — rotate bracelet`);
      const label = document.createElement('span'); label.className = 'space-label';
      label.textContent = relation.name;
      const handle = document.createElement('button');
      handle.className = 'space-move-handle'; handle.type = 'button';
      handle.setAttribute('aria-label', `${relation.name} — move bracelet`);
      handle.title = '끌어서 팔찌 옮기기';
      handle.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 0l3.5 3.8h-7L10 0zM10 20l3.5-3.8h-7L10 20zM0 10l3.8 3.5v-7L0 10zM20 10l-3.8 3.5v-7L20 10zM3 9h14v2H3V9zM9 3h2v14H9V3z"/></svg>';
      handleLayer.append(handle);
      // Randomized once per visit, then attached to the same bracelet while moving.
      const labelX = .08 + Math.random() * .38;
      const labelY = [17, 62, 73, 24, 66, 20, 76, 26, 64, 43, 38, 58][index] / 100;
      object.append(turntable); stage.append(object); labelLayer.append(label);
      turntable.addEventListener('focus', () => label.classList.add('is-focused'));
      turntable.addEventListener('blur', () => label.classList.remove('is-focused'));
      const entry = { video, source, object, turntable, label, handle, relation, index, labelX, labelY,
        offsetX: 0, offsetY: 0, targetOffsetX: 0, targetOffsetY: 0, floatTime: 0, suppressClick: false, handlePoint: null,
        phase: video.currentTime || 0, targetPhase: video.currentTime || 0, velocity: 0,
        pending: null, seekAt: 0, pose: null };
      handle.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        if (!active || transitioning) return;
        if (entry.suppressClick) { entry.suppressClick = false; return; }
        if (entry.handlePoint?.edge) bringIntoView(entry);
      });
      handle.addEventListener('keydown', event => {
        if (!active || transitioning || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === 'Home') {
          event.preventDefault(); event.stopPropagation(); bringIntoView(entry); return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const step = event.shiftKey ? 96 : 40;
        if (event.key === 'ArrowLeft') entry.targetOffsetX -= step / innerWidth;
        if (event.key === 'ArrowRight') entry.targetOffsetX += step / innerWidth;
        if (event.key === 'ArrowUp') entry.targetOffsetY -= step / innerHeight;
        if (event.key === 'ArrowDown') entry.targetOffsetY += step / innerHeight;
        entry.targetOffsetX = clamp(entry.targetOffsetX, -2, 2);
        entry.targetOffsetY = clamp(entry.targetOffsetY, -2, 2);
        requestFrame();
      });
      video.addEventListener('seeked', () => { video.pause(); if (active) requestFrame(); });
      video.addEventListener('loadeddata', () => { if (active) requestFrame(); });
      video.addEventListener('error', () => {
        label.classList.add('has-media-error');
        announcement.textContent = `${relation.name}: video could not be loaded.`;
      });
      turntable.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        seek(entry, (['ArrowLeft', 'ArrowUp'].includes(event.key) || event.shiftKey ? -1 : 1) * 0.35);
      });
      turntable.addEventListener('wheel', event => {
        if (!active || transitioning || event.ctrlKey || event.metaKey) return;
        event.preventDefault(); event.stopPropagation();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
        const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        seek(entry, clamp(delta * unit * 0.028, -2.4, 2.4), true);
      }, { passive: false });
      return entry;
    });

    function seek(entry, delta, eased = false) {
      if (!active || transitioning || !(entry.video.duration > 0) || !Number.isFinite(entry.video.duration)) return;
      if (eased && !reduced.matches) {
        // Bound the remaining travel so a long trackpad gesture stops promptly.
        entry.targetPhase = clamp(entry.targetPhase + delta, entry.phase - 3, entry.phase + 3);
      } else {
        entry.phase += delta; entry.targetPhase = entry.phase; entry.velocity = 0;
        entry.pending = pingPong(entry.phase, Math.max(.001, entry.video.duration - .04));
      }
      requestFrame();
    }
    function easeRotation(entry, dt) {
      if (!dt || (entry.phase === entry.targetPhase && entry.velocity === 0)) return;
      // Critically damped motion: accelerate from rest, then decelerate without
      // overshoot. An idle bracelet has no target change and never rotates.
      const omega = 18;
      const difference = entry.phase - entry.targetPhase;
      const spring = entry.velocity + omega * difference;
      const decay = Math.exp(-omega * dt);
      entry.phase = entry.targetPhase + (difference + spring * dt) * decay;
      entry.velocity = (entry.velocity - omega * spring * dt) * decay;
      if (Math.abs(entry.phase - entry.targetPhase) < .001 && Math.abs(entry.velocity) < .015) {
        entry.phase = entry.targetPhase; entry.velocity = 0;
      }
      entry.pending = pingPong(entry.phase, Math.max(.001, entry.video.duration - .04));
    }
    function stopRotation(entry) {
      entry.video.pause();
      entry.phase = entry.targetPhase = entry.video.currentTime;
      entry.velocity = 0; entry.pending = null;
    }
    function pump(entry, now) {
      if (entry.pending === null || entry.video.seeking || entry.video.readyState < 2 || now < entry.seekAt) return;
      const target = entry.pending; entry.pending = null; entry.seekAt = now + 1000 / 30;
      entry.video.pause();
      if (Math.abs(entry.video.currentTime - target) > .001) entry.video.currentTime = target;
    }
    function position(entry) {
      const [u, v, sizeFactor] = layout[entry.index];
      const w = innerWidth, h = innerHeight;
      const scale = Math.min(w / 1440, h / 900);
      const phase = entry.index * 1.87;
      const t = entry.floatTime * (.84 + entry.index * .045);
      const moving = !reduced.matches;
      const driftX = moving ? (Math.sin(t * .18 + phase) * 33 + Math.sin(t * .071 + phase * .7) * 13) * scale : 0;
      const driftY = moving ? (Math.cos(t * .16 + phase) * 31 + Math.sin(t * .24 + phase * .8) * 11) * scale : 0;
      const angle = moving ? Math.sin(t * .13 + phase) * 4 : 0;
      const size = Math.min(w * .32, h * .54) * sizeFactor;
      return { x: (u + panX + entry.offsetX) * w - size / 2 + driftX,
        y: (v + panY + entry.offsetY) * h - size / 2 + driftY,
        size, angle, opacity: 1 };
    }
    const transform = pose => `translate(${pose.x}px, ${pose.y}px) scale(${pose.size / 280}) translate(140px, 140px) rotate(${pose.angle || 0}deg) translate(-140px, -140px)`;
    const labelTransform = (entry, pose) => `translate(${pose.x + pose.size * entry.labelX}px, ${pose.y + pose.size * entry.labelY}px)`;
    function place(entry, pose = position(entry)) {
      entry.pose = pose; entry.object.style.transform = transform(pose);
      entry.object.style.opacity = pose.opacity;
      // The separate label layer keeps lettering upright as the bracelet turns.
      entry.label.style.transform = labelTransform(entry, pose);
    }
    function bringIntoView(entry) {
      const pose = entry.pose || position(entry);
      entry.targetOffsetX = entry.offsetX + (innerWidth / 2 - pose.x - pose.size / 2) / innerWidth;
      entry.targetOffsetY = entry.offsetY + (innerHeight / 2 - pose.y - pose.size / 2) / innerHeight;
      announcement.textContent = `${entry.relation.name}: brought into view.`;
      requestFrame();
    }
    function placeHandles() {
      const occupied = [];
      entries.forEach(entry => {
        if (!entry.pose) return;
        const pose = entry.pose;
        const rawX = pose.x + pose.size * .17, rawY = pose.y + pose.size * .24;
        let x = clamp(rawX, 25, innerWidth - 25), y = clamp(rawY, 25, innerHeight - 25);
        const edge = x !== rawX || y !== rawY;
        // Keep navigation accessible and keep recovered edge handles distinct.
        if (x < 95 && y < 90) { x = 95; y = Math.max(40, y); }
        if (x < 85 && Math.abs(y - innerHeight / 2) < 65) x = 85;
        const originX = x, originY = y;
        for (let attempt = 0; attempt < 18 && occupied.some(p => Math.hypot(p.x - x, p.y - y) < 36); attempt++) {
          const direction = attempt % 2 ? -1 : 1;
          y = clamp(originY + direction * (Math.floor(attempt / 2) + 1) * 38, 25, innerHeight - 25);
          if (attempt > 9) x = clamp(originX + (originX > innerWidth / 2 ? -1 : 1) * 40, 25, innerWidth - 25);
        }
        occupied.push({ x, y });
        entry.handlePoint = { x, y, edge };
        entry.handle.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        entry.handle.classList.toggle('is-edge', edge);
        entry.handle.title = edge ? '화면 밖 팔찌 · 클릭해서 가져오기 / 끌어서 옮기기' : '끌어서 팔찌 옮기기';
      });
    }
    function requestFrame() { if (!raf && active && !document.hidden) raf = requestAnimationFrame(render); }
    function render(now) {
      raf = 0;
      const dt = Math.min(.05, previous ? (now - previous) / 1000 : 0); previous = now;
      if (!transitioning) {
        const ease = 1 - Math.exp(-dt * 9);
        panX += (targetPanX - panX) * ease; panY += (targetPanY - panY) * ease;
        entries.forEach(entry => {
          if (drag?.moveEntry !== entry && drag?.entry !== entry) entry.floatTime += dt;
          entry.offsetX += (entry.targetOffsetX - entry.offsetX) * ease;
          entry.offsetY += (entry.targetOffsetY - entry.offsetY) * ease;
          place(entry); easeRotation(entry, dt); pump(entry, now);
        });
        placeHandles();
      }
      if (active && (!reduced.matches || entries.some(e => e.pending !== null || Math.abs(e.targetOffsetX - e.offsetX) + Math.abs(e.targetOffsetY - e.offsetY) > .0001) || Math.abs(targetPanX - panX) + Math.abs(targetPanY - panY) > .0001)) requestFrame();
    }
    stage.addEventListener('pointerdown', event => {
      if (!active || transitioning || event.button !== 0) return;
      const button = event.target.closest('.space-turntable');
      const handle = event.target.closest('.space-move-handle');
      const entry = entries.find(e => e.turntable === button);
      const moveEntry = entries.find(e => e.handle === handle);
      if (entry || moveEntry) stopRotation(entry || moveEntry);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, entry, moveEntry, distance: 0, capture: handle || stage };
      if (moveEntry) { moveEntry.suppressClick = false; moveEntry.handle.classList.add('is-dragging'); }
      (handle || button || stage).focus({ preventScroll: true });
      drag.capture.setPointerCapture(event.pointerId); stage.classList.add('is-dragging');
    });
    stage.addEventListener('pointermove', event => {
      if (!active || transitioning) return;
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      drag.x = event.clientX; drag.y = event.clientY;
      drag.distance += Math.hypot(dx, dy);
      if (drag.moveEntry) {
        const entry = drag.moveEntry;
        entry.offsetX = entry.targetOffsetX = clamp(entry.offsetX + dx / innerWidth, -2, 2);
        entry.offsetY = entry.targetOffsetY = clamp(entry.offsetY + dy / innerHeight, -2, 2);
      } else if (drag.entry) seek(drag.entry, (Math.abs(dx) > Math.abs(dy) ? dx : dy) * .025);
      else { targetPanX = clamp(targetPanX + dx / innerWidth, -.18, .18); targetPanY = clamp(targetPanY + dy / innerHeight, -.18, .18); }
      requestFrame();
    });
    function endDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      if (drag.capture.hasPointerCapture(event.pointerId)) drag.capture.releasePointerCapture(event.pointerId);
      if (drag.moveEntry) {
        drag.moveEntry.suppressClick = event.type === 'pointerup' && drag.distance > 4;
        drag.moveEntry.handle.classList.remove('is-dragging');
      }
      drag = null; stage.classList.remove('is-dragging'); requestFrame();
    }
    stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
    function resetView() {
      targetPanX = targetPanY = 0;
      entries.forEach(entry => { entry.targetOffsetX = entry.targetOffsetY = 0; });
      requestFrame();
    }
    stage.addEventListener('dblclick', event => {
      if (!event.target.closest('.space-turntable, .space-move-handle')) resetView();
    });
    root.addEventListener('keydown', event => {
      if (!active || transitioning || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === 'r' || event.key === 'Home') {
        event.preventDefault(); resetView();
      } else if (event.target === stage) {
        if (event.key === 'ArrowLeft') targetPanX = clamp(targetPanX - .04, -.18, .18);
        else if (event.key === 'ArrowRight') targetPanX = clamp(targetPanX + .04, -.18, .18);
        else if (event.key === 'ArrowUp') targetPanY = clamp(targetPanY - .04, -.18, .18);
        else if (event.key === 'ArrowDown') targetPanY = clamp(targetPanY + .04, -.18, .18);
        else return;
        event.preventDefault(); requestFrame();
      }
    });
    document.addEventListener('visibilitychange', () => {
      previous = 0; entries.forEach(stopRotation);
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else requestFrame();
    });
    window.addEventListener('resize', () => { if (active && !transitioning) { entries.forEach(e => place(e)); placeHandles(); } });
    reduced.addEventListener('change', () => {
      entries.forEach(stopRotation); requestFrame();
    });

    async function move(entering, { immediate = false, peer = 'themes' } = {}) {
      if (drag?.capture.hasPointerCapture(drag.id)) drag.capture.releasePointerCapture(drag.id);
      drag?.moveEntry?.handle.classList.remove('is-dragging');
      drag = null; stage.classList.remove('is-dragging');
      entries.forEach(stopRotation);
      transitioning = true; active = true;
      root.dataset.phase = entering ? 'entering' : 'leaving';
      const direct = peer === 'about';
      root.hidden = false; root.inert = direct;
      const duration = reduced.matches || immediate ? 0 : direct ? 1050 : entering ? 1100 : 900;
      const timing = { duration, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'both' };
      const sidebarX = direct ? 0 : clamp(sourceCards[0]?.getBoundingClientRect().x ?? innerWidth, 0, innerWidth);
      const outside = direct ? '-100%' : `${sidebarX}px`;
      const animations = [];
      for (const entry of entries) {
        if (entering) {
          entry.phase = entry.targetPhase = entry.video.currentTime;
          entry.video.pause();
          entry.turntable.append(entry.video);
        }
        entry.pending = null;
        if (direct) {
          // The whole gallery travels as one sheet; no bracelet visits the rail.
          if (entering) place(entry, position(entry));
          continue;
        }
        const rect = entry.source?.getBoundingClientRect();
        const origin = rect ? { x: rect.x - sidebarX, y: clamp(rect.y, -rect.height, innerHeight), size: rect.width,
          opacity: Number(getComputedStyle(entry.source).opacity) } :
          { x: 0, y: innerHeight / 2 - 100, size: 200, opacity: 0 };
        const destination = position(entry);
        const from = entering ? origin : entry.pose || destination;
        const to = entering ? destination : origin;
        place(entry, to);
        animations.push(entry.object.animate([
          { transform: transform(from), opacity: from.opacity },
          { transform: transform(to), opacity: to.opacity }
        ], timing), entry.label.animate([
          { transform: labelTransform(entry, from) },
          { transform: labelTransform(entry, to) }
        ], timing));
      }
      const fromX = entering ? outside : '0px', toX = entering ? '0px' : outside;
      root.style.transform = `translateX(${toX})`;
      animations.push(root.animate([
        { transform: `translateX(${fromX})` },
        { transform: `translateX(${toX})` }
      ], timing));
      root.classList.toggle('is-open', entering);
      await Promise.all(animations.map(a => a.finished.catch(() => {})));
      animations.forEach(a => a.cancel());
      if (entering) {
        transitioning = false; root.dataset.phase = 'open'; root.inert = false;
        previous = 0; entries.forEach(e => place(e)); placeHandles(); requestFrame();
      } else {
        active = false; cancelAnimationFrame(raf); raf = 0;
        if (direct) {
          root.hidden = true;
          for (const entry of entries) entry.source?.append(entry.video);
        } else {
          await settleIntoSidebar();
        }
        transitioning = false; root.dataset.phase = 'closed';
      }
    }
    async function settleIntoSidebar() {
      root.dataset.phase = 'settling';
      root.inert = true;
      const stills = [];
      // Keep the displayed frame in the opaque panel while the same paused
      // video returns underneath it, inside Themes' actual opacity and mask.
      // Crossfading these aligned layers avoids a hard black-to-gradient swap.
      entries.forEach(entry => {
        entry.video.pause(); entry.pending = null;
        if (!entry.source) return;
        if (!reduced.matches && entry.video.readyState >= 2 && entry.video.videoWidth) {
          const still = document.createElement('canvas');
          still.className = 'space-return-frame';
          still.setAttribute('aria-hidden', 'true');
          still.width = entry.video.videoWidth; still.height = entry.video.videoHeight;
          const context = still.getContext('2d');
          if (context) {
            context.drawImage(entry.video, 0, 0, still.width, still.height);
            entry.turntable.append(still); stills.push(still);
          }
        }
        entry.source.append(entry.video);
      });
      const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: reduced.matches ? 0 : 420,
        easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both'
      });
      await fade.finished.catch(() => {});
      root.hidden = true;
      fade.cancel();
      stills.forEach(still => still.remove());
    }
    root.hidden = true; root.inert = true;
    return { enter: options => move(true, options), exit: options => move(false, options) };
  };
})();
