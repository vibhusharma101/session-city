// "Share your city": renders a 1200x675 postcard of the city and offers ways to post it.
import { drawCity, worldBounds, KINDS } from './world.js';
import { iso } from './util.js';

export const REPO_URL = 'https://github.com/vibhusharma101/session-city';

function sky(ctx, w, h, night) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (night > 0.5) { g.addColorStop(0, '#0d1430'); g.addColorStop(1, '#25305e'); }
  else { g.addColorStop(0, '#8fd0ee'); g.addColorStop(1, '#e6f4ea'); }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function renderPostcard(world, stats, { night, showNames, t, player }) {
  const W = 1200, H = 675;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  sky(ctx, W, H, night);

  // fit the city into the right two-thirds, leaving room for the caption
  const b = worldBounds(world);
  const area = { x: 360, y: 40, w: W - 400, h: H - 80 };
  const s = Math.min(area.w / (b.x1 - b.x0), area.h / (b.y1 - b.y0), 1.6);
  const ox = area.x + area.w / 2 - ((b.x0 + b.x1) / 2) * s;
  const oy = area.y + area.h / 2 - ((b.y0 + b.y1) / 2) * s;
  ctx.setTransform(s, 0, 0, s, ox, oy);
  drawCity(ctx, world, { night, t, hover: null, selected: null, marker: false }, player);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (showNames) {
    ctx.font = '600 13px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const blk of world.blocks) {
      if (!blk.name) continue;
      const [wx, wy] = iso(blk.bx + blk.B, blk.by + blk.B);
      const x = wx * s + ox, y = wy * s + oy + 14;
      const w = ctx.measureText(blk.name).width + 16;
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.beginPath(); ctx.roundRect(x - w / 2, y - 11, w, 22, 11); ctx.fill();
      ctx.fillStyle = '#1d2333'; ctx.fillText(blk.name, x, y);
    }
  }

  // caption card
  const dark = night > 0.5;
  ctx.fillStyle = dark ? 'rgba(14,19,40,.82)' : 'rgba(255,255,255,.88)';
  ctx.beginPath(); ctx.roundRect(36, 40, 320, H - 80, 22); ctx.fill();
  const fg = dark ? '#eef1f8' : '#1d2333', muted = dark ? '#a8b0c8' : '#5a6380';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = muted; ctx.font = '600 15px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText('MY SESSION CITY', 64, 92);
  ctx.fillStyle = fg; ctx.font = '800 64px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(String(stats.sessions), 64, 168);
  ctx.font = '600 20px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(stats.sessions === 1 ? 'Claude Code session' : 'Claude Code sessions', 64, 198);

  const rows = [
    [stats.projects, stats.projects === 1 ? 'project district' : 'project districts'],
    [stats.tallest, 'turns in my tallest tower'],
    [stats.actions.toLocaleString(), 'actions by my agents'],
  ];
  rows.forEach(([v, label], i) => {
    const y = 262 + i * 54;
    ctx.fillStyle = fg; ctx.font = '700 26px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(String(v), 64, y);
    ctx.fillStyle = muted; ctx.font = '500 15px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(label, 64, y + 22);
  });
  if (stats.topKind) {
    const k = KINDS[stats.topKind];
    ctx.fillStyle = k.color;
    ctx.beginPath(); ctx.roundRect(64, 438, 14, 14, 3); ctx.fill();
    ctx.fillStyle = fg; ctx.font = '600 16px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(`Mostly ${k.label}s · ${k.desc}`, 86, 451);
  }
  ctx.fillStyle = muted; ctx.font = '500 14px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText('Build yours:', 64, H - 96);
  ctx.fillStyle = fg; ctx.font = '600 14px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(REPO_URL.replace('https://', ''), 64, H - 74);
  return c;
}

export function cityStats(world) {
  const sessions = world.buildings.map((b) => b.s);
  const counts = {};
  for (const s of sessions) counts[s.kind] = (counts[s.kind] || 0) + 1;
  return {
    sessions: sessions.length,
    projects: world.blocks.filter((b) => b.name).length,
    tallest: Math.max(0, ...sessions.map((s) => s.turns)),
    actions: sessions.reduce((n, s) => n + Object.values(s.tools || {}).reduce((a, b) => a + b, 0), 0),
    topKind: Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
}

const toBlob = (canvas) => new Promise((res) => canvas.toBlob(res, 'image/png'));

export function openShare(modal, getPostcard) {
  let showNames = false;
  let blob = null, url = null;

  const shareText = (st) => `My Claude Code city: ${st.sessions} sessions across ${st.projects} projects. Build yours 👇`;

  async function render() {
    const { canvas, stats } = getPostcard(showNames);
    blob = await toBlob(canvas);
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    modal.querySelector('img').src = url;
    modal.dataset.text = shareText(stats);
  }

  modal.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <button class="x" aria-label="Close">✕</button>
      <h2 id="share-title">Share your city</h2>
      <img alt="Postcard of your Session City">
      <label class="check"><input type="checkbox" id="names"> Show project names</label>
      <p class="hint">Project names are hidden by default. Nothing is uploaded: the image is made on this machine and you choose where it goes.</p>
      <div class="actions">
        <button data-act="download" class="primary">Download image</button>
        <button data-act="copy">Copy image</button>
        <button data-act="native" hidden>Share…</button>
        <button data-act="x">Post on X</button>
        <button data-act="linkedin">Post on LinkedIn</button>
      </div>
      <p class="status" aria-live="polite"></p>
    </div>`;
  modal.hidden = false;
  const status = modal.querySelector('.status');
  const say = (msg) => { status.textContent = msg; };
  const close = () => { modal.hidden = true; if (url) URL.revokeObjectURL(url); };

  modal.querySelector('.x').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  modal.querySelector('#names').onchange = (e) => { showNames = e.target.checked; render(); };

  const file = () => new File([blob], 'my-session-city.png', { type: 'image/png' });
  const nativeBtn = modal.querySelector('[data-act="native"]');
  nativeBtn.hidden = !(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] }));

  modal.querySelector('.actions').onclick = async (e) => {
    const act = e.target.dataset?.act;
    if (!act || !blob) return;
    const text = modal.dataset.text;
    if (act === 'download') {
      const a = document.createElement('a');
      a.href = url; a.download = 'my-session-city.png'; a.click();
      say('Saved my-session-city.png');
    } else if (act === 'copy') {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        say('Image copied. Paste it into your post.');
      } catch {
        say('Your browser blocked copying images. Use Download instead.');
      }
    } else if (act === 'native') {
      try { await navigator.share({ files: [file()], text, url: REPO_URL }); } catch { /* cancelled */ }
    } else if (act === 'x' || act === 'linkedin') {
      // Social sites can't receive an image through a link, so download it first.
      const a = document.createElement('a');
      a.href = url; a.download = 'my-session-city.png'; a.click();
      const intent = act === 'x'
        ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(REPO_URL)}`
        : `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(REPO_URL)}`;
      window.open(intent, '_blank', 'noopener');
      say(`Image downloaded. Attach my-session-city.png to your ${act === 'x' ? 'post' : 'LinkedIn post'}.`);
    }
  };
  render();
  return close;
}
