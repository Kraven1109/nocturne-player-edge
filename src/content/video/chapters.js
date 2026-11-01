export const chapterAt = (chapters, time) => {
  let current = null;
  for (const chapter of chapters) {
    if (chapter.start > time) break;
    current = chapter;
  }
  return current;
};
