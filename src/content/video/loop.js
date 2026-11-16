import { isFeedShaped } from '../gestures/swipe.js';
import { setSiteLoop } from '../page/bridge.js';

// Standalone HTML5 videos and local file:// MediaDocuments only need the pure
// `video.loop` DOM property (unlike `seek` or `setVolume`, changing `loop`
// never tears down streams). Calling `setSiteLoop` keeps YouTube's context
// menu checkbox in sync and stays a clean no-op on every other host.
export const isLoopAllowedForVideo = ({
  viewportWidth,
  viewportHeight,
  videoWidth,
  videoHeight,
}) => {
  if (
    !Number.isFinite(videoWidth) ||
    !Number.isFinite(videoHeight) ||
    videoWidth <= 0 ||
    videoHeight <= 0
  ) {
    return false;
  }
  return !isFeedShaped(viewportWidth, viewportHeight, videoWidth, videoHeight);
};

export const createLooper = (
  video,
  { isAllowed = () => true, apply, read } = {},
) => {
  const applyLoop =
    apply ??
    ((enabled) => {
      setSiteLoop(video, enabled);
      video.loop = enabled;
    });
  const readLoop = read ?? (() => Boolean(video.loop));

  const set = (enabled) => {
    const next = Boolean(enabled);
    if (next && !isAllowed()) return false;
    applyLoop(next);
    return Boolean(readLoop());
  };

  return {
    isAllowed: () => Boolean(isAllowed()),
    isLooping: () => Boolean(readLoop()),
    set,
    destroy: () => {},
  };
};
