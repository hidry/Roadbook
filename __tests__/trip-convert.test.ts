import { modelFromTrip, stopsFromModel, tracksFromModel } from '@/lib/route-model';
import type { RouteModel } from '@/lib/route-model';
import type { Stop, Track } from '@/types/models';

const model: RouteModel = {
  name: 'Norwegen',
  stops: [
    { name: 'Bergen', lat: 60.39, lng: 5.32, time: '2025-08-01T10:00:00Z', notes: 'Hafen' },
    { name: null, lat: 61, lng: 6, time: null, notes: null },
  ],
  tracks: [
    { name: 'Etappe 1', points: [{ lat: 60.39, lng: 5.32, time: null, ele: null }, { lat: 60.5, lng: 5.5, time: null, ele: null }] },
    { name: 'leer', points: [{ lat: 1, lng: 1, time: null, ele: null }] }, // single point: useless as a line
  ],
};

describe('stopsFromModel', () => {
  it('appends after existing stops and keeps existing start/end roles', () => {
    const inputs = stopsFromModel(model, 3);
    expect(inputs.map((s) => s.position)).toEqual([3, 4]);
    expect(inputs.every((s) => s.role === 'stop')).toBe(true);
  });

  it('makes the first point the start when the trip is empty', () => {
    expect(stopsFromModel(model, 0)[0].role).toBe('start');
  });

  it('derives arrivalDate from time and names unnamed points', () => {
    const inputs = stopsFromModel(model, 0);
    expect(inputs[0].arrivalDate).toBe('2025-08-01');
    expect(inputs[1].name).toBe('Import 2');
    expect(inputs[1].arrivalDate).toBeNull();
  });
});

describe('tracksFromModel', () => {
  it('drops tracks with fewer than 2 points', () => {
    const tracks = tracksFromModel(model);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].name).toBe('Etappe 1');
  });
});

describe('modelFromTrip', () => {
  const base = { id: 'x', createdAt: 'c', updatedAt: 'u', deletedAt: null };
  const stops: Stop[] = [
    { ...base, id: 's2', tripId: 't', position: 1, role: 'stop', type: null, name: 'Ohne GPS', lat: 0, lng: 0, arrivalDate: null, notes: null },
    { ...base, id: 's1', tripId: 't', position: 0, role: 'start', type: null, name: 'Bergen', lat: 60.39, lng: 5.32, arrivalDate: '2025-08-01', notes: 'Hafen' },
  ];
  const tracks: Track[] = [
    { ...base, id: 'tr1', tripId: 't', name: 'Etappe 1', points: [{ lat: 60.39, lng: 5.32, time: null, ele: null }] },
  ];

  it('orders by position, skips unlocated stops, keeps tracks', () => {
    const m = modelFromTrip('Norwegen', stops, tracks);
    expect(m.name).toBe('Norwegen');
    expect(m.stops).toHaveLength(1); // 0/0 stop skipped
    expect(m.stops[0]).toEqual({ name: 'Bergen', lat: 60.39, lng: 5.32, time: '2025-08-01', notes: 'Hafen' });
    expect(m.tracks).toHaveLength(1);
  });
});
