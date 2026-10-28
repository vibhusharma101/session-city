// Greedy label placement, kept free of the DOM and Three.js so it can be tested.
//
// Each candidate has a screen box { l, r, t, b }, a priority and a `force` flag.
// Higher priority claims space first. An ordinary label that would overlap a
// placed one is dropped. A forced label (one that must always show) is never
// dropped: if it would cover another label it climbs above it instead (or
// moves below it, with `dir: 1`), so must-shows stack rather than draw on top
// of each other. `reserved` boxes (the top bar) keep ordinary labels out;
// forced ones may pass over them.
// Returns the labels to show, each with the vertical shift `dy` it was given.

export const overlaps = (a, b, pad = 0) => a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad;

export function place(cands, reserved = [], pad = 6) {
  const order = [...cands].sort((a, b) => (!!b.force - !!a.force) || (b.pri - a.pri));
  const placed = [], shown = [];
  for (const c of order) {
    let box = c.box, dy = 0;
    if (c.force) {
      for (let i = 0; i < 24; i++) {
        const hit = placed.find((p) => overlaps(box, p, pad));
        if (!hit) break;
        const step = c.dir === 1 ? hit.b - box.t + pad : -(box.b - hit.t + pad);
        dy += step;
        box = { l: box.l, r: box.r, t: box.t + step, b: box.b + step };
      }
    } else if (placed.some((p) => overlaps(box, p, pad)) || reserved.some((p) => overlaps(box, p, pad))) continue;
    placed.push(box);
    shown.push({ c, dy });
  }
  return shown;
}
