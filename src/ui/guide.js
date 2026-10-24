import { feltBetsGlossary, trackBetsGlossary } from './betDiagrams.js';
import { INK, lineMark, markImg, oldTallies } from './marks.js';

// The Info book (design doc 7.5, Phase 8): how the game works, a page per
// tab, in plain words with an example for each mechanic. It opens over the
// room like the Almanac and borrows its look. The numbers here are the
// game's own (docs/GAME_DESIGN.md): change them there and here together.

const el = (tag, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

// Each page: a short tab label, then sections of a heading, paragraphs
// (trusted HTML written here, never player input) and, for some, a builder
// for what follows them (the bets' diagrams).
export const GUIDE = [
  {
    id: 'idea',
    label: 'The idea',
    sections: [
      ['You owe the House', [
        'You wake at a roulette table in a dark hall. A brass Cage tells you what you owe and how many nights you have to pay it. Madame Zero, an automaton fortune teller, runs the House.',
        'Each night you buy spins and play chips on the felt. What the chips win, you bank at the Cage. When the third night ends, the Cage collects: if your deposits cover the debt, it is paid and a bigger one begins. If not, the run is over, and you join the figures standing in the dark.',
      ]],
      ['The goal', [
        'Pay debt after debt until you reach the <b>goal</b>: debt 4 on your first runs. Pay it, and the Cage will let you <b>step out of the light</b>: the run is won. Or play on, as far as the debts let you.',
        'Going deeper opens more of the House for later runs: chip sets, starting wheels, harder House Edge levels, new talismans, cards and records. Paying debt 8 opens the Vault, and after that, an Endless mode.',
      ]],
      ['What makes it more than roulette', [
        'You do not gamble your chips: you own them. A chip on a bet pays when the bet wins and does nothing when it loses. The risk is the coin you pay for every spin.',
        'Around that, you build: talismans that change how chips pay, a wheel you can reshape, luck you can plan for, and a Devil who takes the coins you did not bank.',
      ]],
    ],
  },
  {
    id: 'night',
    label: 'Nights',
    sections: [
      ['Debts and nights', [
        'A run is a string of <b>debts</b>, and each debt has <b>3 nights</b>. At the start of a night you choose one of three cards on the felt:',
        '<b>Long night</b>: 7 spins, paid up front at 7 × the spin cost. <b>Short night</b>: 3 spins and +1 token now. <b>Sit out</b>: no spins, and +3 tokens when the debt is paid.',
        'A spin costs more each debt, as the Fibonacci numbers do: 1 coin in debt 1, then 2, 3, 5, 8… Debt 1 owes 60, debt 2 owes 370, debt 3 owes 666.',
      ]],
      ['The Cage', [
        'Coins you win land <b>in hand</b>. At the Cage you <b>bank</b> them: <b>Bank all</b>, or <b>Bank, keep</b> to keep enough for tomorrow’s night. Banked coins count toward the debt and can never be spent again.',
        'At the end of every night, banked coins earn <b>5% interest</b>, and the Cage pays <b>+1 token</b>. Example: 200 banked at the end of night 1 becomes 210.',
        'When the debt is paid, the surplus stays banked, and you get +2 tokens and coins worth 3 spins of the next debt.',
      ]],
      ['Coins and tokens', [
        '<b>Coins</b> buy spins, the Cabinet’s restocks and oddities, and Madame Zero’s rerolls. <b>Tokens</b> (brass casino tokens) buy talismans. You start with 10 coins, 4 tokens and 3 chips.',
      ]],
    ],
  },
  {
    id: 'bets',
    label: 'Bets',
    sections: [
      ['Chips on the felt', [
        'Place a chip on any bet on the felt. Chips stay where you left them from spin to spin, and moving them is free. Several chips can share a bet; each pays on its own.',
        'A winning chip pays its bet’s <b>odds</b>: the fewer numbers a bet covers, the more it pays. Example: a chip of value 1 straight-up on 17 pays 36 coins when 17 comes up; a chip on Red pays 2 whenever any red number does.',
        '<b>Zero</b> is green and belongs to the House: it loses every bet that does not cover it.',
      ]],
      ['The bets, by name', [
        'Every bet on the felt has a name. In each picture the lit numbers are the ones the bet covers, and the chip shows where it goes: in the game, tap a chip, then that spot on the felt.',
      ], feltBetsGlossary],
      ['Stake and Odds', [
        'A chip pays its value × <b>Stake</b> × its odds × the <b>Odds</b> mult × any talisman multipliers. Stake and the Odds mult start at 1, and talismans add to them: <b>+1 Stake doubles a chip’s payout</b>. The two brass plaques beside the felt show them.',
        'Each kind of bet has a <b>level</b>; a level adds a quarter of the base odds (a straight-up at level 2 pays 45). The payout placard at the felt’s right lists every kind and what it pays now.',
      ]],
      ['The racetrack', [
        'Across the top of the felt lie seven special bets, most of them on stretches of the wheel rather than the felt. They are dark until a talisman, a card or a record opens them. The wheel pictures show the pockets each covers, with zero at the top; the number in the middle is how many.',
      ], trackBetsGlossary],
    ],
  },
  {
    id: 'luck',
    label: 'Luck',
    sections: [
      ['Nudge', [
        '<b>Nudge</b> is luck counted in pockets. After the ball settles, it may hop up to that many pockets along the wheel, either way, to the pocket that pays you most. Every hop throws a spark.',
        'Example: your chip is on 17 and the ball stops two pockets away from it. With 2 Nudge it hops onto 17 and pays.',
        'So spread straight-ups <b>around the wheel</b>, not around the table: then any Nudge has something to reach. Talismans, Lucky pockets and the Dowsing Rod give Nudge.',
      ]],
      ['The Lean', [
        'Now and then the House leans. A Lean is free Nudge, and it is <b>announced one spin early</b>: the LEAN lamp on the results board lights with its strength, the bulb hums brighter and the wheel creaks, all <b>before</b> you bet.',
        'Example: the lamp shows +4. Move chips onto straight-ups spread round the wheel for that spin, and the ball will hop up to 4 pockets to find one.',
        'In debt 1 the Leans come often and gently (+2). Later, a long night has one Lean of +3 to +5 (3 more on the night’s last spin), and from debt 5 they come only every other night.',
      ]],
      ['Pity', [
        'After <b>5 misses in a row</b> (spins where nothing pays), the House takes pity: +1 Nudge, then +1 more for each further miss, until something pays. Pity’s spark is cold blue, so you can tell it from a Lean. The results board shows it building.',
      ]],
    ],
  },
  {
    id: 'devil',
    label: 'The Devil',
    sections: [
      ['666', [
        'The wheel’s numbers add up to 666. Once you pay debt 2, the House notices you: a green <b>666</b> counter lights on the Cage, and from then on every spin has a small chance that the Devil fires.',
        'It starts at 1.5% in debt 3 and grows by 0.5% each debt, up to 25%. The counter always shows the exact chance.',
      ]],
      ['When he fires', [
        'The spin pays nothing, the bulb goes out, and <b>every coin in hand is lost</b>. Banked coins are safe. That is why you bank.',
        'Some talismans lower his chance (Salt Cellar, Evil Eye), Holy Water turns him away once, and a few cursed things feed on him.',
        'If he fired this debt before you visit Madame Zero, she deals <b>black cards</b>.',
      ]],
    ],
  },
  {
    id: 'talismans',
    label: 'Talismans',
    sections: [
      ['The rail', [
        'Talismans are curios that change the rules: a Red Ribbon gives chips on red +1 Stake, a Horseshoe gives straight-ups +12 odds. They hang on the brass rail above the table, six hooks to start.',
        '<b>Order matters</b>: they act left to right. A Twin Mirrors copies the talisman to its right; a Tuning Fork repeats the one to its left. Drag a charm along the rail to move it.',
        'Hold or hover on a charm to read it. Selling one returns half its price in tokens. A <b>cursed</b> talisman (dealt only by black cards) can never come off.',
      ]],
      ['The Curio Cabinet', [
        'Turn right to the Cabinet. It shows three talismans and one <b>oddity</b>. Talismans cost tokens by rarity: common 3, uncommon 4, rare 6, legendary 9. Oddities cost coins.',
        'The Cabinet restocks free at the start of every night; a restock between costs coins, a little more each time in a debt. Some talismans carry an <b>engraving</b>, a small extra rule.',
      ]],
      ['The Bell', [
        'The brass bell on the table wakes <b>active</b> talismans, each with a few charges a debt. A ring wakes the leftmost that can answer; tap a charm’s tag to ring for that one.',
        'Examples: the <b>Wheel of Fortune</b>, rung before a spin, throws the ball again if that spin pays nothing. The <b>Glass Eye</b> shows where the next spin will land, so you can bet on it.',
      ]],
    ],
  },
  {
    id: 'zero',
    label: 'Madame Zero',
    sections: [
      ['Her booth', [
        'Turn left past the Cage to her glass booth. <b>Once a debt</b>, pull her lever: she deals <b>three fortune cards</b>, and you take one. The first pull is free; another deal costs coins (the debt’s number, then one more each time).',
        'Taking a card ends the visit until the next debt.',
      ]],
      ['White and black cards', [
        '<b>White cards</b> are fortunes: "A stranger tips well." gives tokens, "The reds run warm tonight." widens every red pocket, "Another hook on the wall." adds a hook to the rail.',
        '<b>Black cards</b> are deals with a price: big upside and real damage. She deals them when the Devil fired earlier in the debt, before your first pull. So you can choose to visit before the risky spins, or after.',
      ]],
    ],
  },
  {
    id: 'records',
    label: 'Records',
    sections: [
      ['The gramophone', [
        'Beside Madame Zero stands a gramophone. A <b>record</b> changes the music and <b>one rule</b> for as long as it plays.',
        'Examples: <b>Red Light Tango</b> doubles red payouts and halves black ones. <b>Lullaby for Zero</b> keeps the Devil away, and the Leans with him. <b>Overture of Excess</b> triples every payout but doubles the debt.',
        'Records come from the Cabinet’s oddities and from a white card. Swapping is free, but only the record playing counts. Opening the Vault’s second lock gives the gramophone a second slot.',
      ]],
    ],
  },
  {
    id: 'wheel',
    label: 'The wheel',
    sections: [
      ['Pockets you can build', [
        'Every pocket has a number, a colour and a <b>width</b>: the chance of landing there is its share of the wheel, and the wheel is drawn to scale. A widened pocket is wider on screen.',
        '<b>Wheel work</b> changes the wheel: make a number’s pockets wider or narrower, paint a pocket, give a number a second pocket, remove a pocket, or change a pocket’s number. It comes from the Cabinet’s oddities, some cards and the Number Punches.',
      ]],
      ['Enhanced pockets', [
        'A pocket can have one special finish: <b>gold</b> pays ×2 (paint it gold again for <b>platinum</b>, ×3), <b>glass</b> pays ×4 but may break, <b>bone</b> gives a token, <b>lucky</b> gives Nudge on the next spin, <b>ember</b> raises a winning chip’s value for the rest of the run. A <b>cursed</b> pocket raises the Devil’s chance; a <b>blank</b> one has no number and pays nothing.',
      ]],
      ['Reading it', [
        'The chalkboard at the table’s left chalks every number’s current chance. The results board at the right shows the last numbers, the LEAN lamp, Nudge and pity. Hold or hover on any bet to see how often it wins on this wheel.',
      ]],
    ],
  },
  {
    id: 'beyond',
    label: 'Runs',
    sections: [
      ['The Vault', [
        'At the back of the hall stands an iron door with four padlocks. Pay debt 4 and the first falls open; each later debt opens the next. Every lock moves your goal one debt further and opens a starting wheel and new talismans, cards or records. Pay debt 8 with all four open and the Vault opens.',
      ]],
      ['Chips, wheels and the House Edge', [
        'Pay debt 4 with a chip set and the next set unlocks: Clay, Bone, Glass, then Gold, each with its own rule. Locks open the American, Golden, Bone and Mirror wheels. Reaching your goal at the hardest <b>House Edge</b> open opens the next level, five in all, each making the House harder.',
        'Choose them on the chip select before a run. Once the Vault is open it also offers <b>Endless</b>: no goal, play until the Cage collects.',
      ]],
      ['The figures and the Almanac', [
        'Every run that ends without stepping out of the light leaves its figure standing in the dark. The <b>Almanac</b>, the book on the table, keeps what you have seen, your feats (which open new content), the figures’ stories and your best runs.',
      ]],
    ],
  },
  {
    id: 'controls',
    label: 'Controls',
    sections: [
      ['On a phone', [
        'Swipe, or tap the arrows at the screen’s edges, to turn between Madame Zero, the Cage, the table and the Cabinet. Tap a chip, then a bet, to place it; the felt leans in close while you bet. Tap SPIN; hold it for a fast spin.',
        'Hold on anything to read its note; notes carry their actions (Buy, Sell, Ring). The menu button at the top right pauses.',
      ]],
      ['With a mouse and keys', [
        'Drag chips onto the felt and hover on anything for its note. <b>Space</b> spins, <b>A</b>/<b>D</b> or the arrows turn, <b>1</b>–<b>3</b> choose a night, <b>E</b> ends the night, <b>B</b> rings the Bell, <b>R</b> restocks, <b>F</b> toggles fast spins, <b>M</b> mutes, <b>Tab</b> walks the controls and <b>Esc</b> opens the menu.',
      ]],
    ],
  },
];

/** Opens the Info book on its first page (or `start`). Returns { close, open }. */
export function showGuide({ start = GUIDE[0].id, onClose } = {}) {
  const backdrop = el('div', 'modal-backdrop almanac guide');
  backdrop.append(markImg(oldTallies(240, 520, 311, [[10, 10, 12, 1.4], [20, 110, 9, 1.4], [6, 210, 14, 1.4]]), 'wall wall-l', 1));
  const card = el('div', 'almanac-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'How to play');
  const head = el('header', 'alm-head');
  head.append(el('h2', 'scrawl fat', 'How to play'));
  const closeBtn = el('button', 'alm-close');
  closeBtn.type = 'button';
  closeBtn.append(el('span', 'label scrawl fat', 'Close'));
  head.append(closeBtn);
  const tabs = el('nav', 'alm-tabs');
  const page = el('div', 'alm-page');
  page.tabIndex = 0;
  card.append(head, tabs, markImg(lineMark(900, 12, 43, INK.boneDim, 2, { y0: 6, y1: 7, stretch: true }), 'alm-rule'), page);
  backdrop.append(card);

  const buttons = [closeBtn];
  function open(id) {
    page.textContent = '';
    page.scrollTop = 0;
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.page === id);
    for (const [heading, paragraphs, extra] of GUIDE.find((p) => p.id === id).sections) {
      const section = el('section', 'guide-section');
      section.append(el('h3', 'scrawl fat', heading));
      for (const text of paragraphs) section.append(el('p', 'typed', text));
      if (extra) section.append(extra());
      page.append(section);
    }
  }
  for (const p of GUIDE) {
    const b = el('button', 'alm-tab');
    b.type = 'button';
    b.dataset.page = p.id;
    b.append(el('span', 'label scrawl', p.label));
    b.addEventListener('click', () => open(p.id));
    tabs.append(b);
    buttons.push(b);
  }

  const onKey = (ev) => {
    if (backdrop.inert) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
      return;
    }
    if (ev.key !== 'Tab') return;
    ev.preventDefault();
    ev.stopPropagation();
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + (ev.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  };
  document.addEventListener('keydown', onKey, true);

  function close() {
    document.removeEventListener('keydown', onKey, true);
    if (backdrop.contains(document.activeElement)) document.activeElement.blur();
    backdrop.inert = true;
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 250);
    onClose?.();
  }
  closeBtn.addEventListener('click', close);

  document.body.append(backdrop);
  open(start);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  closeBtn.focus({ focusVisible: true });
  return { close, open };
}
