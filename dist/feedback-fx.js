(function feedbackEffects() {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const selector = 'button, a[href], summary, select, label:has(input:is([type="checkbox"],[type="radio"]))';
  const limit = 5;
  const active = new Map();
  const sheets = {
    tap: { file: 'tap.webp', frames: 8, ratio: 80 / 136, ms: 255 },
    unlock: { file: 'unlock.webp', frames: 21, ratio: 108 / 112, ms: 1080 },
  };
  const pressed = new WeakMap();
  let layer;

  function clear(node) {
    window.clearTimeout(active.get(node));
    active.delete(node);
    node.remove();
  }

  function rootFor(target) {
    const host = target?.closest?.('dialog[open]') ?? document.body;
    if (layer?.parentElement === host) return layer;
    for (const node of active.keys()) clear(node);
    layer?.remove();
    layer = document.createElement('div');
    layer.className = 'vault-fx-layer';
    layer.setAttribute('aria-hidden', 'true');
    host.append(layer);
    return layer;
  }

  function sprite(target, kind, x, y, width) {
    if (reduced.matches || document.hidden || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const host = rootFor(target);
    if (active.size >= limit) clear(active.keys().next().value);
    const { file, frames, ratio, ms } = sheets[kind];
    const clip = document.createElement('span');
    clip.className = `vault-fx vault-fx-${kind}`;
    Object.assign(clip.style, {
      left: x + 'px', top: y + 'px', width: width + 'px', height: width * ratio + 'px',
    });
    clip.style.setProperty('--fx-frames', frames);
    clip.style.setProperty('--fx-ms', ms + 'ms');
    const strip = document.createElement('img');
    strip.src = `assets/fx/${file}`;
    strip.alt = '';
    strip.draggable = false;
    strip.style.width = width * frames + 'px';
    clip.append(strip);
    host.append(clip);
    strip.addEventListener('animationend', () => clear(clip), { once: true });
    active.set(clip, window.setTimeout(() => clear(clip), ms + 100));
  }

  function control(target) {
    const node = target.closest?.(selector);
    return node && !node.matches(':disabled, [aria-disabled="true"], :has(input:disabled)') ? node : null;
  }

  function press(node, position) {
    if (!node.matches('[data-sound-toggle]')) window.DarkVaultSound?.cue('tap');
    node.classList.add('vault-pressed');
    window.clearTimeout(pressed.get(node));
    pressed.set(node, window.setTimeout(() => node.classList.remove('vault-pressed'), 170));
    const point = position ?? node.getBoundingClientRect();
    sprite(node, 'tap', position ? point.clientX : point.left + point.width / 2,
      position ? point.clientY : point.top + point.height / 2, 58);
  }

  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    const node = control(event.target);
    if (node) press(node, event);
  }, { capture: true, passive: true });
  document.addEventListener('click', event => {
    if (event.detail !== 0) return;
    const node = control(event.target);
    if (node) press(node);
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) for (const node of active.keys()) clear(node);
  });

  function confirm(node, kind, earned = false) {
    if (!node || document.hidden) return;
    node.dataset.feedback = kind;
    node.classList.add('vault-confirmed');
    window.clearTimeout(pressed.get(node));
    pressed.set(node, window.setTimeout(() => node.classList.remove('vault-confirmed'), 1100));
    if (!earned || reduced.matches) return;
    const rect = node.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) return;
    const art = node.querySelector('.unlock-art')?.getBoundingClientRect() ?? rect;
    const width = kind === 'collect' ? 156 : 110;
    sprite(node, 'unlock', art.left + art.width / 2, art.top + art.height / 2, width);
  }

  // The tap strip is tiny and common. The reward strip stays on demand.
  if (!reduced.matches) new Image().src = 'assets/fx/tap.webp';
  window.DarkVaultFx = { confirm };
})();
