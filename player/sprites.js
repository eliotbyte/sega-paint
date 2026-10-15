// Which note picture goes where. The pictures themselves are in art/notes (see pixel.js).
import { NOTE_NAMES, picture } from './pixel.js';

export const SPRITE_POOL = NOTE_NAMES;

// Names used by older song files.
const ALIAS = {
  invader: 'ufo', apple: 'heart', cherry: 'ring', crown: 'coin', rocket: 'plane', flower: 'fly', note: 'guitar',
  flame: 'bomb', clover: 'mushroom',
};
export const spriteName = (name) => (NOTE_NAMES.includes(name) ? name : ALIAS[name] || 'star');

export const ROLE_SPRITE = { bass: 'cheese', perc: 'cymbal', lead: 'ufo', psg: 'ghost', echo: 'bat', noise: 'star', dac: 'drum', sample: 'guitar' };
// Layers that use several instruments get a different sprite per instrument (most used first).
export const ROLE_SET = {
  bass: ['cheese', 'mushroom', 'star', 'bell'],
  perc: ['cymbal', 'drum', 'star', 'bell', 'mushroom', 'snare'],
  lead: ['ufo', 'mushroom', 'star', 'bell'],
};

// Sonic on the playhead: art/pictures/sonicIdle (stopped), sonicWalk (playing), any number of frames.
export const sonic = (pose, frame) => picture('sonic' + pose, frame);

export const SHARP = ['.o.o.', 'ooooo', '.o.o.', 'ooooo', '.o.o.'];
