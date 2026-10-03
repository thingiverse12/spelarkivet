/** Test double for the audio engine (no AudioContext under jsdom). Every
 *  method is a no-op; spatial() must return a real gain/pan pair because
 *  main.js reads those to decide whether to play a footstep. */
const noop = () => {};

export const audio = new Proxy(
  { spatial: () => ({ gain: 0, pan: 0 }) },
  { get: (target, prop) => (prop in target ? target[prop] : noop) }
);
