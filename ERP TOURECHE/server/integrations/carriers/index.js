import { yalidine } from './yalidine.js';
import { zr } from './zr.js';
import { noest } from './noest.js';

/** الشركات المعتمدة في النظام — واجهة موحدة: test · communes · desks · create · track · fees */
export const CARRIERS = { yalidine, zr, noest };
export const CARRIER_KEYS = Object.keys(CARRIERS);

export function carrier(key) {
  const c = CARRIERS[key];
  if (!c) throw new Error(`unknown_carrier:${key}`);
  return c;
}
