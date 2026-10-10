/* NeuroSync shared client: patient.html and doctor.html read the SAME /api/sync feed. */
(function () {
  const NS = (window.NS = { data: null, ok: false, subs: [] });
  const p2 = (n) => String(n).padStart(2, '0');
  NS.time = (at) => { const d = new Date(at); return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); };
  NS.date = (at) => { const d = new Date(at); return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear(); };
  NS.on = (f) => { NS.subs.push(f); if (NS.data) { try { f(NS.data); } catch (e) { console.warn(e); } } };
  NS.post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).catch(() => {});
  const st = document.createElement('style');
  st.textContent = '.ns-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#9aa8c7;margin-right:8px;vertical-align:middle}.ns-ok .ns-dot{background:#17c98b;box-shadow:0 0 6px #17c98b}';
  document.head.appendChild(st);
  async function tick() {
    try { const r = await fetch('/api/sync', { cache: 'no-store' }); if (!r.ok) throw 0; NS.data = await r.json(); NS.ok = true; } catch (e) { NS.ok = false; }
    document.querySelectorAll('[data-ns]').forEach((el) => el.classList.toggle('ns-ok', NS.ok));
    if (NS.data && NS.ok) NS.subs.forEach((f) => { try { f(NS.data); } catch (e) { console.warn(e); } });
    setTimeout(tick, 1000);
  }
  tick();
})();
