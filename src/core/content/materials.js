// Chip materials (design doc 6.6, decision 26). A run starts with a set of
// chips of one material, chosen on the main menu; chips found later in a run
// follow the same rules, whatever their material. Each is data:
//
//   name      as the chip select and the notes say it
//   count     chips in its starting set
//   payout    multiplies every line the chip pays (the House rounds down)
//   fixed     true: once placed, the chip stays put until the night ends
//   winTokens tokens when the chip wins, `tokenCap` a night at most
//   upside / downside  the chip select's two lines
//
// How each looks is the view's business (ui/chipLook.js).
//
// The list is also the unlock order: paying debt 4 with one set unlocks the
// next for later runs (core/meta.js). Lead and Wax wait for Phase 5.

export const MATERIAL_LIST = [
  {
    id: 'normal',
    name: 'Normal',
    count: 3,
    payout: 1,
    upside: 'The House’s own chips. Nothing gained, nothing lost.',
    downside: '',
  },
  {
    id: 'clay',
    name: 'Clay',
    count: 4,
    payout: 0.75,
    upside: 'Four chips.',
    downside: 'Each pays ×0.75.',
  },
  {
    id: 'bone',
    name: 'Bone',
    count: 3,
    payout: 1.15, // the owner's ×1.25, tuned with the simulator (doc 9.8)
    fixed: true,
    upside: 'Each pays ×1.15.',
    downside: 'Once placed, a chip stays put until the night ends.',
  },
  {
    id: 'glass',
    name: 'Glass',
    count: 2,
    payout: 1.65, // the owner's ×1.5, tuned with the simulator
    upside: 'Each pays ×1.65.',
    downside: 'Only two chips.',
  },
  {
    id: 'gold',
    name: 'Gold',
    count: 3,
    payout: 0.6, // the owner's ×0.75, tuned with the simulator
    winTokens: 1,
    tokenCap: 3,
    upside: '+1 token when one wins, up to 3 a night.',
    downside: 'Each pays ×0.6.',
  },
];
