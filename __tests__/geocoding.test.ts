import { pickPlaceName } from '@/lib/geocoding';

describe('pickPlaceName', () => {
  it('prefers the most specific locality and appends the country', () => {
    expect(pickPlaceName({ address: { city: 'Bergen', country: 'Norwegen' } })).toBe('Bergen, Norwegen');
    expect(pickPlaceName({ address: { village: 'Geiranger', country: 'Norwegen' } })).toBe('Geiranger, Norwegen');
  });

  it('falls back through town/municipality/hamlet', () => {
    expect(pickPlaceName({ address: { town: 'Flåm' } })).toBe('Flåm');
    expect(pickPlaceName({ address: { municipality: 'Aurland' } })).toBe('Aurland');
  });

  it('uses the first part of display_name when no structured locality exists', () => {
    expect(pickPlaceName({ display_name: 'Rastplatz, E16, Norwegen' })).toBe('Rastplatz');
  });

  it('returns null when nothing usable is present', () => {
    expect(pickPlaceName({})).toBeNull();
  });
});
