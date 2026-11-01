import { lockFullscreen, unlockFullscreen } from './page/bridge.js';

// Many film players take the screen for themselves when the phone is turned:
// on landscape they put their own element into fullscreen, on portrait they
// leave it. With our player open, either one took fullscreen away from the
// stage, which read exactly like the user backing out, and the player closed
// in the middle of the turn — leaving the film playing somewhere in the page.
//
// In the Edge/Chromium MV3 port, Element.prototype.requestFullscreen and
// Document.prototype.exitFullscreen are patched at document_start in the MAIN
// world (`pageagent.js`) gated by a boolean flag. Toggling the flag through
// the synchronous CustomEvent bridge blocks the page's calls while leaving
// calls from the isolated content script world untouched.
export const lockPageFullscreen = () => {
  lockFullscreen();
  return () => {
    unlockFullscreen();
  };
};
