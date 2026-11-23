/* =====================================================================
   FermentoSense – efek animasi
   - Lenis          : smooth scroll  (vendor/lenis.min.js, MIT)
   - GSAP           : animasi, ScrollTrigger, SplitText (vendor/*.min.js)
   - Gaya React Bits: SplitText, AnimatedContent, SpotlightCard, ShinyText
     (React Bits berbasis React; di sini efeknya ditulis ulang dengan JS biasa
      karena situs ini HTML statis tanpa build step.)
   Semua efek bersifat tambahan: jika library gagal dimuat, dashboard tetap jalan.
   ===================================================================== */
(() => {
'use strict';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hasGsap = typeof window.gsap !== 'undefined';
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- Spotlight card (tanpa GSAP, tetap jalan saat reduced motion) ---------- */
function spotlight(el) {
  el.classList.add('fx-spot');
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
}
$$('.scard, .card.mini, .chart-card, .status-card, .notif-card').forEach(spotlight);

/* ---------- Shiny text pada judul (dipasang setelah animasi huruf selesai) ---------- */
const shine = () => $('.topbar .title h1')?.classList.add('fx-shiny');

/* ---------- Nilai sensor berdenyut saat berubah ---------- */
if (!reduce) {
  $$('.sval').forEach(el => {
    let prev = el.textContent;
    new MutationObserver(() => {
      if (el.textContent === prev) return;
      prev = el.textContent;
      el.classList.remove('fx-bump'); void el.offsetWidth; el.classList.add('fx-bump');
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
}

if (reduce || !hasGsap) { shine(); return; }

const { gsap } = window;
const ST = window.ScrollTrigger, Split = window.SplitText;
gsap.registerPlugin(...[ST, Split].filter(Boolean));

/* ---------- Lenis smooth scroll, disinkronkan ke ticker GSAP ---------- */
let lenis = null;
if (typeof window.Lenis !== 'undefined') {
  lenis = new window.Lenis({
    lerp: 0.1,
    autoRaf: false,
    allowNestedScroll: true,
    // area yang punya scroll sendiri dibiarkan memakai scroll bawaan
    prevent: node => !!node.closest?.('dialog, pre, textarea, select, .table-wrap, .notif-list, iframe'),
  });
  if (ST) lenis.on('scroll', ST.update);
  gsap.ticker.add(t => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  window.fxLenis = lenis;

  // Saat modal terbuka, halaman di belakangnya tidak ikut bergulir
  const modal = $('#srcModal');
  if (modal) {
    new MutationObserver(() => modal.open ? lenis.stop() : lenis.start())
      .observe(modal, { attributes: true, attributeFilter: ['open'] });
  }
}

/* ---------- SplitText: huruf judul naik satu per satu ---------- */
const splits = new WeakMap();
function splitIn(el, delay = 0, done) {
  if (!el || !Split) { done?.(); return; }
  let s = splits.get(el);
  if (!s) { s = Split.create(el, { type: 'words,chars', aria: 'auto' }); splits.set(el, s); }
  gsap.fromTo(s.chars,
    { yPercent: 70, opacity: 0 },
    { yPercent: 0, opacity: 1, duration: 0.6, ease: 'power3.out', stagger: 0.022, delay, overwrite: true,
      onComplete: done ? () => { s.revert(); splits.delete(el); done(); } : undefined });
}

/* ---------- AnimatedContent: isi halaman masuk berurutan ---------- */
function pageIn(pageEl) {
  if (!pageEl) return;
  const blocks = $$(':scope > *:not(.card.help), :scope > .sensor-row > *, :scope > .main-row > *, :scope > .bottom-row > *', pageEl)
    .filter(el => !el.matches('.sensor-row, .main-row, .bottom-row'));
  gsap.fromTo(blocks,
    { y: 22, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.55, ease: 'power2.out', stagger: 0.06, clearProps: 'transform,opacity', overwrite: true });
  splitIn($('.page-head h2', pageEl), 0.05);

  // Kartu bantuan muncul saat digulir ke dalam layar
  if (ST) {
    const help = $$('.card.help', pageEl).filter(el => !el.dataset.fx);
    help.forEach(el => { el.dataset.fx = '1'; gsap.set(el, { y: 30, opacity: 0 }); });
    if (help.length) {
      ST.batch(help, {
        start: 'top 88%', once: true,
        onEnter: b => gsap.to(b, { y: 0, opacity: 1, duration: 0.6, ease: 'power2.out', stagger: 0.08, clearProps: 'transform,opacity' }),
      });
    }
    requestAnimationFrame(() => ST.refresh());
  }
}

function onPage() {
  if (lenis) { lenis.resize(); lenis.scrollTo(0, { immediate: true, force: true }); }
  pageIn($('.page.active'));
}
window.addEventListener('hashchange', onPage);

/* ---------- Animasi pembuka ---------- */
gsap.from('.sidebar .brand, .sidebar .nav-item', { x: -24, opacity: 0, duration: 0.5, ease: 'power2.out', stagger: 0.05, clearProps: 'transform,opacity' });
gsap.from('.sidebar .side-art', { y: 40, opacity: 0, duration: 0.9, ease: 'power3.out', delay: 0.2, clearProps: 'transform,opacity' });
gsap.from('.top-cards > *', { y: -14, opacity: 0, duration: 0.45, ease: 'power2.out', stagger: 0.06, delay: 0.15, clearProps: 'transform,opacity' });
splitIn($('.topbar .title h1'), 0.1, shine);
gsap.from('.topbar .title p', { opacity: 0, y: 8, duration: 0.5, delay: 0.45, clearProps: 'transform,opacity' });
pageIn($('.page.active'));

})();
