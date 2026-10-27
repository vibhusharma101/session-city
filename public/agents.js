// Agent robots that work inside buildings, and their speech bubbles.
import { ellipse } from './util.js';

function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

// Agent robots that work inside buildings.
// state: 'work' | 'walk' | 'wait' | 'idle' | 'sleep'
export function drawAgent(ctx, x, y, { color = '#e8825e', t = 0, state = 'idle', flip = false, scale = 1, phase = 0 } = {}) {
  const walking = state === 'walk';
  const swing = walking ? Math.sin(t / 80 + phase) : 0;
  const bob = state === 'work' ? Math.abs(Math.sin(t / 140 + phase)) * 1.2 : walking ? Math.abs(Math.cos(t / 80 + phase)) : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip ? -scale : scale, scale);
  ellipse(ctx, 0, 0, 7, 3, 'rgba(0,0,0,.22)');
  ctx.translate(0, -bob);

  ctx.fillStyle = '#4a5068';
  ctx.fillRect(-4 + swing * 1.5, -6, 3, 6);
  ctx.fillRect(1 - swing * 1.5, -6, 3, 6);
  roundRect(ctx, -6, -15, 12, 10, 3, color);
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.fillRect(-3, -12, 6, 2);

  // head with a screen face
  roundRect(ctx, -6.5, -26, 13, 11, 3.5, '#eef1f7');
  roundRect(ctx, -4.8, -24.3, 9.6, 7.6, 2, '#26304a');
  ctx.fillStyle = state === 'wait' ? '#ffd27a' : '#7cf2c8';
  if (state === 'sleep') {
    ctx.fillRect(-3.4, -20.6, 2.6, 0.9);
    ctx.fillRect(0.8, -20.6, 2.6, 0.9);
  } else if (state === 'wait') {
    ctx.fillRect(-0.6, -23.2, 1.4, 3.4);
    ctx.fillRect(-0.6, -19, 1.4, 1.2);
  } else {
    const blink = Math.sin(t / 900 + phase * 3) > 0.97;
    const h = blink ? 0.6 : 2.2;
    ctx.fillRect(-3.4, -21.8 + (2.2 - h) / 2, 2.2, h);
    ctx.fillRect(1.2, -21.8 + (2.2 - h) / 2, 2.2, h);
  }
  ctx.strokeStyle = '#9aa3bd';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -30); ctx.stroke();
  ellipse(ctx, 0, -31, 1.8, 1.8, state === 'sleep' ? '#7d8399' : color);
  ctx.restore();

  if (state === 'sleep') {
    ctx.fillStyle = 'rgba(80,90,120,.8)';
    ctx.font = '600 8px system-ui, sans-serif';
    const p = ((t / 1600) + phase) % 1;
    ctx.globalAlpha = 1 - p;
    ctx.fillText('z', x + 7 + p * 6, y - 30 - p * 12);
    ctx.globalAlpha = 1;
  }
}

export function bubble(ctx, x, y, text, { bg = '#ffffff', fg = '#1d2333', max = 180 } = {}) {
  ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
  let t = text;
  while (ctx.measureText(t).width > max && t.length > 4) t = t.slice(0, -2);
  if (t !== text) t = t.trimEnd() + '…';
  const w = ctx.measureText(t).width + 16, h = 22;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.18)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h, w, h, 8);
  ctx.moveTo(x - 5, y); ctx.lineTo(x, y + 6); ctx.lineTo(x + 5, y);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t, x, y - h / 2);
}
