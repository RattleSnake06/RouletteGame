import { figureShape } from './figureShape.js';
import { zeroShape } from './zeroShape.js';

// Every sculpted shape by name, for the meshing worker (sculptWorker.js).
export const SHAPES = { figure: figureShape, zero: zeroShape };
