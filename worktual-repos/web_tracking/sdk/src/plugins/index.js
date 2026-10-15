import { on } from '../core/event-bus.js';

/** @param {string} name @param {object} plugin */
export function registerPlugin(name, plugin) {
  if (!name || !plugin) return;
  if (plugin.beforeTrack) on('beforeTrack', plugin.beforeTrack);
  if (plugin.afterTrack) on('afterTrack', plugin.afterTrack);
  if (plugin.beforeSend) on('beforeSend', plugin.beforeSend);
  if (plugin.afterSend) on('afterSend', plugin.afterSend);
}
