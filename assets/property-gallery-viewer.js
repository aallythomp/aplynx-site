/* APLYNX property galleries: individual photo collections, never offsite referral links. */
(() => {
  'use strict';
  const dialog = document.getElementById('aplynx-gallery');
  if (!dialog) return;
  const title = document.getElementById('gallery-address');
  const hero = document.getElementById('gallery-preview');
  const counter = document.getElementById('gallery-count');
  const thumbs = document.getElementById('gallery-thumbnails');
  const prev = document.getElementById('gallery-prev');
  const next = document.getElementById('gallery-next');
  const email = document.getElementById('gallery-request');
  const close = document.getElementById('gallery-close');
  let collections = null;
  let active = [];
  let index = 0;
  let label = '';
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const loadCollections = async () => {
    if (collections) return collections;
    try {
      const response = await fetch('/assets/property-galleries.json', {cache:'no-cache'});
      if (response.ok) {
        const data = await response.json();
        collections = data && typeof data === 'object' ? data : {};
      } else collections = {};
    } catch (_) { collections = {}; }
    return collections;
  };
  const render = () => {
    if (!active.length) return;
    hero.src = active[index];
    hero.alt = label + ', listing photo ' + (index + 1);
    counter.textContent = 'Photo ' + (index + 1) + ' of ' + active.length;
    prev.disabled = active.length < 2;
    next.disabled = active.length < 2;
    thumbs.replaceChildren();
    active.forEach((url, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gallery-thumb' + (i === index ? ' active' : '');
      b.setAttribute('aria-label', 'Show photo ' + (i + 1) + ' of ' + label);
      b.setAttribute('aria-pressed', String(i === index));
      const img = document.createElement('img');
      img.src = url; img.alt = ''; img.loading = 'lazy';
      b.appendChild(img);
      b.addEventListener('click', () => { index = i; render(); });
      thumbs.appendChild(b);
    });
    const selected = thumbs.children[index];
    if (selected) selected.scrollIntoView({block:'nearest', inline:'nearest', behavior:'smooth'});
  };
  const move = (delta) => { if (active.length) { index = (index + delta + active.length) % active.length; render(); } };
  prev.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
  });
  document.querySelectorAll('.gallery-open').forEach(button => {
    button.addEventListener('click', async () => {
      const card = button.closest('.property');
      if (!card) return;
      label = card.querySelector('h2').textContent.trim();
      const cover = card.querySelector('.photo-launch img');
      const coverUrl = cover && (cover.getAttribute('src') || cover.src);
      const data = await loadCollections();
      const photos = Array.isArray(data[normalize(label)]) ? data[normalize(label)] : [];
      active = [...new Set([coverUrl, ...photos].filter(url => typeof url === 'string' && (url.startsWith('/assets/') || /^https:\/\//i.test(url))))];
      if (!active.length && coverUrl) active = [coverUrl];
      if (!active.length) return;
      index = 0;
      title.textContent = label;
      email.href = 'mailto:info@aplynxinvestments.com?subject=' + encodeURIComponent('Showing and photos: ' + label);
      render();
      dialog.showModal();
    });
  });
})();
