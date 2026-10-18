'use strict';

/**
 * Decide what the window close button should do.
 *
 * Hiding the window keeps playback alive but leaves the user with no way back if
 * the tray icon is missing, so the tray is a hard requirement.
 */
function closeDecision({ quitting = false, hasTray = false, backgroundPlayback = true } = {}) {
  if (quitting) return 'quit';
  if (!hasTray) return 'quit';
  if (!backgroundPlayback) return 'quit';
  return 'hide';
}

module.exports = { closeDecision };
