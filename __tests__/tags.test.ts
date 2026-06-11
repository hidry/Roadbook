import { collectTags, formatTags, hasTag, parseTagInput } from '@/lib/util/tags';

describe('parseTagInput', () => {
  it('splits on commas, trims and drops empties', () => {
    expect(parseTagInput(' Dethleffs , Sommer,,Norwegen ')).toEqual(['Dethleffs', 'Sommer', 'Norwegen']);
  });

  it('de-duplicates case-insensitively, first spelling wins', () => {
    expect(parseTagInput('Dethleffs, dethleffs, DETHLEFFS')).toEqual(['Dethleffs']);
  });

  it('returns [] for empty input', () => {
    expect(parseTagInput('')).toEqual([]);
    expect(parseTagInput(' , , ')).toEqual([]);
  });
});

describe('formatTags', () => {
  it('joins for the input field (inverse of parseTagInput)', () => {
    const tags = ['Dethleffs', 'Sommer'];
    expect(formatTags(tags)).toBe('Dethleffs, Sommer');
    expect(parseTagInput(formatTags(tags))).toEqual(tags);
  });
});

describe('collectTags', () => {
  it('collects distinct tags across trips, sorted A-Z', () => {
    const trips = [{ tags: ['Sommer', 'Dethleffs'] }, { tags: ['dethleffs', 'Winter'] }, { tags: [] }];
    expect(collectTags(trips)).toEqual(['Dethleffs', 'Sommer', 'Winter']);
  });
});

describe('hasTag', () => {
  it('matches case-insensitively and treats null as match-all', () => {
    const trip = { tags: ['Dethleffs'] };
    expect(hasTag(trip, 'dethleffs')).toBe(true);
    expect(hasTag(trip, 'Sunlight')).toBe(false);
    expect(hasTag(trip, null)).toBe(true);
  });
});
