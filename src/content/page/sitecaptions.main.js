import { call, isFunction, read, toArray, toPage } from '../video/pageapi.js';

const findYouTubePlayer = (host) => {
  if (host !== null && isFunction(host, 'getOption')) return host;
  const element = document.querySelector('#movie_player, .html5-video-player');
  if (element === null) return null;
  const player = element.wrappedJSObject ?? element;
  return isFunction(player, 'getOption') ? player : null;
};

// YouTube keeps its caption list behind the player API rather than in
// video.textTracks, so the list comes from there in the MAIN world and the
// live text comes from the DOM container mirror in the ISOLATED world.
export const createYouTubeTracks = (host) => {
  const player = findYouTubePlayer(host);
  if (player === null) return null;

  const tracklist = () => {
    const list = toArray(call(player, 'getOption', 'captions', 'tracklist'));
    if (list.length > 0) return list;
    call(player, 'loadModule', 'captions');
    return toArray(call(player, 'getOption', 'captions', 'tracklist'));
  };

  const describe = (track, index) => {
    const name = read(track, 'displayName') ?? read(track, 'languageName');
    if (typeof name === 'string' && name !== '') return name;
    const code = read(track, 'languageCode');
    const isNamed = typeof code === 'string' && code !== '';
    return isNamed ? code : `Track ${index + 1}`;
  };

  return {
    list: () => tracklist().map((track, index) => describe(track, index)),
    isOn: () => {
      const track = call(player, 'getOption', 'captions', 'track');
      const code = read(track, 'languageCode');
      return typeof code === 'string' && code !== '';
    },
    activeIndex: () => {
      const current = call(player, 'getOption', 'captions', 'track');
      const code = read(current, 'languageCode');
      if (typeof code !== 'string' || code === '') return -1;
      return tracklist().findIndex(
        (track) => read(track, 'languageCode') === code,
      );
    },
    select: (index) => {
      const track = tracklist()[index];
      if (track === undefined) return false;
      call(player, 'setOption', 'captions', 'track', track);
      return true;
    },
    disable: () => {
      call(player, 'setOption', 'captions', 'track', toPage({}));
    },
  };
};
