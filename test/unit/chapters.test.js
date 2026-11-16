import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chapterAt } from '../../src/content/video/chapters.js';
import {
  readChaptersSnapshot,
  readSiteChapters,
} from '../../src/content/page/chapters.main.js';

const CHAPTERS = [
  { title: 'Intro', start: 0 },
  { title: 'The plan', start: 65 },
  { title: 'The heist', start: 240 },
];

test('the chapter is the last one that has started', () => {
  assert.equal(chapterAt(CHAPTERS, 0).title, 'Intro');
  assert.equal(chapterAt(CHAPTERS, 64.9).title, 'Intro');
  assert.equal(chapterAt(CHAPTERS, 65).title, 'The plan');
  assert.equal(chapterAt(CHAPTERS, 1200).title, 'The heist');
});

test('a time before the first chapter has no chapter', () => {
  assert.equal(chapterAt([{ title: 'Later', start: 30 }], 10), null);
  assert.equal(chapterAt([], 10), null);
});

const markers = (...titles) =>
  titles.map((title, index) => ({
    chapterRenderer: {
      title: { simpleText: title },
      timeRangeStartMillis: index * 30000,
    },
  }));

const watchData = (videoId, ...titles) => ({
  currentVideoEndpoint: { watchEndpoint: { videoId } },
  playerOverlays: { markers: markers(...titles) },
});

// getPlayerResponse() on YouTube names the video but carries no chapters.
const hostPlaying = (videoId) => ({
  getPlayerResponse: () => ({ videoDetails: { videoId } }),
});

const withPage = ({ initialData, flexyData, mobileData, href }, run) => {
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    ytInitialData: globalThis.ytInitialData,
    location: globalThis.location,
  };
  globalThis.window = globalThis;
  globalThis.document = {
    // Matches by tag name over a selector list, as the real thing would.
    querySelector: (selector) => {
      const tags = selector.split(',').map((tag) => tag.trim());
      if (tags.includes('ytd-watch-flexy') && flexyData !== undefined) {
        return { data: flexyData };
      }
      if (tags.includes('ytm-watch') && mobileData !== undefined) {
        return { data: mobileData };
      }
      return null;
    },
  };
  globalThis.ytInitialData = initialData;
  if (href !== undefined) globalThis.location = { href };
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
};

test('chapters come from page data when the player response has none', () => {
  withPage({ initialData: watchData('B', 'One', 'Two') }, () => {
    const list = readSiteChapters(hostPlaying('B'));
    assert.deepEqual(
      list.map((chapter) => [chapter.title, chapter.start]),
      [
        ['One', 0],
        ['Two', 30],
      ],
    );
  });
});

test('page data frozen on an earlier video is not trusted', () => {
  withPage({ initialData: watchData('A', 'Old 1', 'Old 2') }, () => {
    assert.deepEqual(readSiteChapters(hostPlaying('B')), []);
  });
});

test('the live watch data wins over a stale initial blob', () => {
  withPage(
    {
      initialData: watchData('A', 'Old 1', 'Old 2'),
      flexyData: watchData('B', 'New 1', 'New 2'),
    },
    () => {
      const list = readSiteChapters(hostPlaying('B'));
      assert.deepEqual(
        list.map((chapter) => chapter.title),
        ['New 1', 'New 2'],
      );
    },
  );
});

test('a blob that names no video is still read', () => {
  const unnamed = { playerOverlays: { markers: markers('One', 'Two') } };
  withPage({ initialData: unnamed }, () => {
    assert.equal(readSiteChapters(hostPlaying('B')).length, 2);
    assert.equal(readSiteChapters(null).length, 2);
  });
});

test('the id comes from getVideoData when the response names none', () => {
  const host = {
    getPlayerResponse: () => ({}),
    // eslint-disable-next-line camelcase
    getVideoData: () => ({ video_id: 'B' }),
  };
  withPage({ initialData: watchData('A', 'Old 1', 'Old 2') }, () => {
    assert.deepEqual(readChaptersSnapshot(host).chapters, []);
    assert.equal(readChaptersSnapshot(host).videoId, 'B');
  });
  withPage({ initialData: watchData('B', 'One', 'Two') }, () => {
    assert.equal(readChaptersSnapshot(host).chapters.length, 2);
  });
});

test('the id comes from the address when the player names none', () => {
  const href = 'https://www.youtube.com/watch?v=B&t=5';
  withPage({ initialData: watchData('A', 'Old 1', 'Old 2'), href }, () => {
    const snap = readChaptersSnapshot(null);
    assert.equal(snap.videoId, 'B');
    assert.deepEqual(snap.chapters, []);
  });
  withPage({ initialData: watchData('B', 'One', 'Two'), href }, () => {
    assert.equal(readChaptersSnapshot(null).chapters.length, 2);
  });
});

test('no chapters are offered while an advertisement is showing', () => {
  const host = {
    ...hostPlaying('B'),
    classList: { contains: (name) => name === 'ad-showing' },
  };
  withPage({ initialData: watchData('B', 'One', 'Two') }, () => {
    assert.deepEqual(readChaptersSnapshot(host), {
      videoId: 'B',
      isAd: true,
      chapters: [],
    });
  });
});

test('the phone site reads its live watch data from <ytm-watch>', () => {
  withPage(
    {
      initialData: watchData('A', 'Old 1', 'Old 2'),
      mobileData: watchData('B', 'New 1', 'New 2'),
    },
    () => {
      const list = readSiteChapters(hostPlaying('B'));
      assert.deepEqual(
        list.map((chapter) => chapter.title),
        ['New 1', 'New 2'],
      );
    },
  );
});

test('the phone site inherits nothing when the live data has none', () => {
  withPage(
    {
      initialData: watchData('A', 'Old 1', 'Old 2'),
      mobileData: watchData('B'),
    },
    () => {
      assert.deepEqual(readSiteChapters(hostPlaying('B')), []);
    },
  );
});
