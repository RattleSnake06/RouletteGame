// How each chip material looks (design doc 6.6, decision 26): one painter for
// the chips on the felt (view/chips.js) and the chip select (ui/menu.js), so
// a Bone chip is the same chip wherever it appears.
//
//   base, mark   the face and the edge inserts
//   ink          the value on the face
//   surface      how the chip's material catches the light in the room

export const CHIP_LOOK = {
  normal: { base: '#cdbf9f', mark: '#7a1418', ink: '#7a1418', surface: { roughness: 0.7, metalness: 0 } },
  clay: { base: '#93512f', mark: '#3b2015', ink: '#f0d9bf', surface: { roughness: 0.95, metalness: 0 }, grit: true },
  bone: { base: '#e2d6bb', mark: '#3e3226', ink: '#2e241a', surface: { roughness: 0.55, metalness: 0 }, cracks: true },
  glass: { base: '#2f5f5a', mark: '#cfeee6', ink: '#e8fff8', surface: { roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.82 } },
  gold: { base: '#c19343', mark: '#5c3b0e', ink: '#3e2706', surface: { roughness: 0.32, metalness: 0.75 } },
};

export const lookOf = (material) => CHIP_LOOK[material] ?? CHIP_LOOK.normal;

/** A chip's face on a square canvas of `size`: inserts, rings, and the value. */
export function paintChipFace(ctx, size, material, label = '') {
  const look = lookOf(material);
  const c = size / 2;
  const k = size / 256;
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = look.base;
  ctx.fillRect(0, 0, size, size);
  if (look.grit) {
    // Fired clay: pitted and uneven.
    for (let i = 0; i < 900; i++) {
      const x = ((i * 97) % 256) * k;
      const y = ((i * 57 + (i >> 3) * 13) % 256) * k;
      ctx.fillStyle = i % 3 ? 'rgba(40, 18, 8, 0.18)' : 'rgba(255, 220, 190, 0.08)';
      ctx.fillRect(x, y, 2 * k, 2 * k);
    }
  }
  if (material === 'glass') {
    // A sheen across the glass.
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
    g.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.fillStyle = look.mark;
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate((i / 8) * Math.PI * 2);
    ctx.fillRect(-14 * k, -128 * k, 28 * k, 30 * k);
    ctx.restore();
  }
  ctx.strokeStyle = look.mark;
  ctx.lineWidth = 5 * k;
  ctx.beginPath();
  ctx.arc(c, c, 82 * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([6 * k, 8 * k]);
  ctx.lineWidth = 3 * k;
  ctx.beginPath();
  ctx.arc(c, c, 70 * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (look.cracks) {
    // Old bone, crazed and stained along its cracks.
    ctx.strokeStyle = 'rgba(70, 52, 34, 0.55)';
    ctx.lineWidth = 1.6 * k;
    for (const [x0, y0, dx, dy] of [
      [40, 60, 50, 40],
      [180, 40, -30, 70],
      [200, 190, -60, 20],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x0 * k, y0 * k);
      ctx.lineTo((x0 + dx * 0.5) * k, (y0 + dy * 0.6) * k);
      ctx.lineTo((x0 + dx) * k, (y0 + dy) * k);
      ctx.stroke();
    }
  }
  if (label) {
    ctx.fillStyle = look.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const px = label.length <= 1 ? 92 : label.length === 2 ? 76 : 54;
    ctx.font = `600 ${px * k}px Oswald, "Arial Narrow", sans-serif`;
    ctx.fillText(label, c, c + 4 * k, 120 * k);
  }
  ctx.restore();
}

/** The chip's edge, as a strip that wraps round it: the base with its inserts. */
export function paintChipEdge(ctx, width, height, material) {
  const look = lookOf(material);
  ctx.fillStyle = look.base;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = look.mark;
  for (let i = 0; i < 8; i++) ctx.fillRect(((i * 64 + 18) / 512) * width, 0, (28 / 512) * width, height);
}
