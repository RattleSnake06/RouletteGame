import '@fontsource/oswald/latin-500.css';
import '@fontsource/oswald/latin-600.css';
import '@fontsource/special-elite/latin-400.css';
import mansalvaUrl from '@fontsource/mansalva/files/mansalva-latin-400-normal.woff2?url';
import rockSaltUrl from '@fontsource/rock-salt/files/rock-salt-latin-400-normal.woff2?url';

// The game's lettering (design doc 8.4).
//   Scrawl: words scratched or brushed onto the dark (HUD values, titles).
//   Typed:  small print, labels and the Cage's voice.
//   Oswald: the casino's own hardware (felt, chips, counters, marquee).
//
// Scrawl is Rock Salt with two glyphs taken from Mansalva. Rock Salt's 1 is a
// bare stroke that reads as l or /, and its comma is a speck, so 1,552 would
// read as l552.

export const SCRAWL = "Scrawl, 'Rock Salt', cursive";
export const TYPED = "'Special Elite', 'Courier New', monospace";
export const SANS = "Oswald, 'Arial Narrow', sans-serif";

export async function loadFonts() {
  const faces = [
    new FontFace('Scrawl', `url(${rockSaltUrl}) format('woff2')`),
    new FontFace('Scrawl', `url(${mansalvaUrl}) format('woff2')`, { unicodeRange: 'U+0031, U+002C', sizeAdjust: '135%' }),
  ];
  for (const face of faces) document.fonts.add(face);
  // Canvas lettering and measured marks need the faces before first use.
  await Promise.all([
    ...faces.map((face) => face.load()),
    document.fonts.load('600 64px Oswald'),
    document.fonts.load('500 64px Oswald'),
    document.fonts.load("20px 'Special Elite'"),
  ]).catch(() => {});
}
