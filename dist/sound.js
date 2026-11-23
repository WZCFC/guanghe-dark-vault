(function warehouseSound() {
  'use strict';
  const Constructor = window.AudioContext ?? window.webkitAudioContext;
  const toggles = document.querySelectorAll('[data-sound-toggle]');
  const pages = ['home', 'arena', 'online', 'slots'].map(id => document.getElementById(id));
  const storage = 'guanghe-sound-enabled';
  const music = document.createElement('audio');
  music.id = 'warehouse-bgm';
  music.preload = 'none';
  music.loop = true;
  music.hidden = true;
  document.body.append(music);

  // Offset and playback length in the web export of the original Godot clips.
  const cues = {
    tap: [0, .07, .39], scan: [.155, .18, .74], seal: [.42, .14, .68],
    round: [.645, .34, .56], urgent: [1.07, .055, .65], win: [1.21, .67997, .82],
    loss: [1.97497, .28, .56], reveal: [2.33997, .65, .52], collect: [3.07497, 1.25, .79],
  };
  let enabled = false;
  try { enabled = localStorage.getItem(storage) === '1'; } catch {}
  let armed = false;
  let context, musicGain, effectsGain, bank, bankTask;
  let retriableAt = 0;
  let latestTap = -Infinity;
  const activeSources = new Set();
  const limit = 5;
  const playingScene = () => !document.hidden && pages.some(page => !page.hidden);

  function loadBank() {
    if (bankTask || !context || performance.now() < retriableAt) return bankTask;
    bankTask = fetch('assets/audio/luck-cues.mp3?v=25')
      .then(response => {
        if (!response.ok) throw new Error('Audio bank unavailable');
        return response.arrayBuffer();
      }).then(bytes => context.decodeAudioData(bytes))
      .then(decoded => { bank = decoded; })
      .catch(() => { bankTask = null; retriableAt = performance.now() + 6000; });
    return bankTask;
  }

  function refresh() {
    for (const toggle of toggles) {
      toggle.setAttribute('aria-pressed', String(enabled));
      toggle.textContent = enabled ? '声音已开' : '开启声音';
    }
    const playing = enabled && armed && playingScene();
    if (context) {
      const stamp = context.currentTime;
      musicGain.gain.setTargetAtTime(playing ? .42 : 0, stamp, .025);
      effectsGain.gain.setTargetAtTime(playing ? .8 : 0, stamp, .025);
    }
    if (!playing) {
      if (!music.paused) music.pause();
      for (const source of activeSources) source.stop();
      activeSources.clear();
      return;
    }
    if (!music.hasAttribute('src')) music.src = 'assets/audio/menu-v07.mp3?v=25';
    if (music.paused) void music.play().catch(() => {});
    if (!bank) void loadBank();
  }

  function unlock() {
    if (!enabled) return;
    armed = true;
    if (!context && Constructor) {
      try {
        context = new Constructor();
        musicGain = context.createGain();
        effectsGain = context.createGain();
        musicGain.gain.value = 0;
        effectsGain.gain.value = 0;
        context.createMediaElementSource(music).connect(musicGain).connect(context.destination);
        effectsGain.connect(context.destination);
      } catch {
        void context?.close().catch(() => {});
        context = null;
        music.volume = .42;
      }
    }
    if (context?.state === 'suspended' || context?.state === 'interrupted') void context.resume().catch(() => {});
    refresh();
  }

  function cue(name) {
    if (!enabled || !armed || !playingScene() || context?.state !== 'running' || !cues[name]) return;
    if (!bank) { void loadBank(); return; }
    if (name === 'tap') {
      if (context.currentTime - latestTap < .07) return;
      latestTap = context.currentTime;
      if (activeSources.size >= limit) return;
    } else if (activeSources.size >= limit) {
      const oldest = activeSources.values().next().value;
      oldest.stop();
      activeSources.delete(oldest);
    }
    const [offset, duration, volume] = cues[name];
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = bank;
    gain.gain.value = volume;
    source.connect(gain).connect(effectsGain);
    source.addEventListener('ended', () => activeSources.delete(source), { once: true });
    source.start(0, offset, duration);
    activeSources.add(source);
  }

  function toggleSound() {
    enabled = !enabled;
    try { localStorage.setItem(storage, enabled ? '1' : '0'); } catch {}
    if (enabled) unlock();
    else refresh();
  }
  for (const toggle of toggles) {
    toggle.hidden = false;
    toggle.addEventListener('click', toggleSound);
  }
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-sound-toggle]') && enabled &&
        (!armed || (context && context.state !== 'running') || (playingScene() && music.paused))) unlock();
  });
  const observer = new MutationObserver(refresh);
  for (const page of pages) observer.observe(page, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', refresh);
  refresh();
  window.DarkVaultSound = { cue };
})();
