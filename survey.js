(function experienceSurvey() {
  'use strict';
  const dialog = document.querySelector('#survey-dialog');
  const seenKey = 'guanghe-wjx-survey-reminded-v1';
  let reminded = false;
  let timer;

  function wasReminded() {
    if (reminded) return true;
    try { return localStorage.getItem(seenKey) === '1'; }
    catch { return false; }
  }

  function markReminded() {
    reminded = true;
    try { localStorage.setItem(seenKey, '1'); } catch {}
  }

  function remind(settlement) {
    if (!settlement || wasReminded() || typeof dialog.showModal !== 'function') return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!settlement.isConnected || settlement.closest('[hidden]') || document.hidden ||
        document.querySelector('dialog[open]') || wasReminded()) return;
      dialog.showModal();
      markReminded();
    }, 2400);
  }

  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-survey-dismiss], [data-survey-open]')) dialog.close();
  });
  document.querySelector('#feedback a[target="_blank"]').addEventListener('click', markReminded);
  window.DarkVaultSurvey = { remind };
})();
