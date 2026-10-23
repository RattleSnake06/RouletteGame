// Pocket enhancements (design doc 6.5). A pocket carries at most one: a new
// one replaces the old, except that gilding a gilded pocket makes it
// platinum. Each is data, read by the spin (payout.js, resolve.js):
//
//   mult      chips that win on this pocket pay × this
//   nudge     Nudge on the next spin, after the ball lands here
//   shatter   the chance a landing breaks the pocket into a blank
//   tokens    tokens when the ball lands here
//   chipValue value a chip that wins here gains, for good
//   devil     the Devil's chance for the rest of the night, after a landing
//   carves    false: wheel work cannot put it on a pocket (it comes some other way)
//
// A blank pocket has no number and no colour (wheel.js): nothing wins there.

export const ENHANCEMENT_LIST = [
  { id: 'gilded', name: 'Gilded', mult: 2, text: 'Chips that win here pay ×2. Gild it again and it turns platinum.' },
  { id: 'platinum', name: 'Platinum', mult: 3, text: 'Chips that win here pay ×3.' },
  { id: 'lucky', name: 'Lucky', nudge: 2, text: '+2 Nudge on the spin after the ball lands here.' },
  { id: 'glass', name: 'Glass', mult: 4, shatter: 0.25, text: 'Chips that win here pay ×4. One landing in four shatters it into a blank.' },
  { id: 'bone', name: 'Bone', tokens: 1, text: '+1 token whenever the ball lands here.' },
  { id: 'ember', name: 'Ember', chipValue: 1, text: 'A chip that wins here gains +1 value, for good.' },
  { id: 'cursed', name: 'Cursed', devil: 0.01, text: "When the ball lands here, the Devil's chance +1% for the rest of the night." },
  { id: 'blank', name: 'Blank', carves: false, text: 'No number. Nothing wins here.' },
  // House Edge 1 (doc 7.2): a green pocket with no number, which no wheel work can touch.
  { id: 'house', name: 'The House’s pocket', carves: false, text: 'Green, and no number: every bet loses here. No tool touches it.' },
];
