/* Escalation state machine, shared by the Node backend and the browser.
   window (45 s to dismiss) -> call Sarah -> call clinic -> emergency services.
   Dismissing, or anyone in the care circle answering, resolves the episode. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Escalation = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FAR = 8.64e15; // "never" (JSON-safe, unlike Infinity)
  const CFG = { window: 45, ring: 20 }; // seconds
  const ORDER = ['window', 'sarah', 'clinic', 'emergency'];
  const dur = (s) => (s === 'window' ? CFG.window : s === 'sarah' || s === 'clinic' ? CFG.ring : 0);

  function start(now, opts) {
    return {
      stage: 'window', t0: now, stageStart: now, deadline: now + dur('window') * 1000,
      total: dur('window'), entered: ['window'], auto: !opts || opts.auto !== false, how: null,
    };
  }

  /* Moves the episode forward to `now`. Returns the stages newly entered. */
  function advance(ep, now) {
    const entered = [];
    for (;;) {
      const i = ORDER.indexOf(ep.stage);
      if (i < 0 || ep.stage === 'emergency' || now < ep.deadline) break;
      const next = ORDER[i + 1];
      ep.stage = next;
      ep.stageStart = ep.deadline;
      ep.total = dur(next);
      ep.deadline = next === 'emergency' ? FAR : ep.deadline + dur(next) * 1000;
      ep.entered.push(next);
      entered.push(next);
    }
    return entered;
  }

  function resolve(ep, how) {
    if (ep.stage !== 'resolved') { ep.stage = 'resolved'; ep.how = how; ep.deadline = FAR; }
    return ep;
  }

  return { CFG, ORDER, FAR, start, advance, resolve, dur };
});
