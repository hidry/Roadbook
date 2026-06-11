import {
  detectRouteFormat,
  parseGpx,
  parseKml,
  parseKmlCoordinates,
  parseRouteFile,
  routeModelStats,
  toGpx,
  toKml,
  type RouteModel,
} from '@/lib/route-model';

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Komoot" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Norwegen 2025</name></metadata>
  <wpt lat="60.3913" lon="5.3221"><name>Bergen</name><time>2025-08-01T10:00:00Z</time><desc>Hafen</desc></wpt>
  <wpt lat="62.4722" lon="6.1495"><name>Ålesund</name></wpt>
  <wpt lat="invalid" lon="6.0"><name>kaputt</name></wpt>
  <trk>
    <name>Etappe 1</name>
    <trkseg>
      <trkpt lat="60.3913" lon="5.3221"><ele>12.5</ele><time>2025-08-01T10:00:00Z</time></trkpt>
      <trkpt lat="60.5" lon="5.5"></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="60.7" lon="5.8"></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const GPX_ROUTE_ONLY = `<?xml version="1.0"?>
<gpx version="1.0" creator="Garmin">
  <rte>
    <name>Küstenroute</name>
    <rtept lat="58.97" lon="5.73"><name>Stavanger</name></rtept>
    <rtept lat="60.39" lon="5.32"><name>Bergen</name></rtept>
  </rte>
</gpx>`;

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>MyMaps Export</name>
    <Folder>
      <Placemark>
        <name>Bergen</name>
        <description>Hafen</description>
        <Point><coordinates>5.3221,60.3913,0</coordinates></Point>
      </Placemark>
    </Folder>
    <Placemark>
      <name>Fahrt</name>
      <LineString><coordinates>
        5.3221,60.3913,0
        5.5,60.5
        5.8,60.7,120
      </coordinates></LineString>
    </Placemark>
  </Document>
</kml>`;

describe('parseGpx', () => {
  it('maps wpt -> stops and trk/trkseg -> one concatenated track', () => {
    const m = parseGpx(GPX);
    expect(m.name).toBe('Norwegen 2025');
    expect(m.stops).toHaveLength(2); // invalid lat dropped
    expect(m.stops[0]).toEqual({
      name: 'Bergen',
      lat: 60.3913,
      lng: 5.3221,
      time: '2025-08-01T10:00:00Z',
      notes: 'Hafen',
    });
    expect(m.tracks).toHaveLength(1);
    expect(m.tracks[0].name).toBe('Etappe 1');
    expect(m.tracks[0].points).toHaveLength(3); // both segments
    expect(m.tracks[0].points[0].ele).toBe(12.5);
    expect(m.tracks[0].points[1].ele).toBeNull();
  });

  it('maps rte/rtept -> stops (a GPX route is an ordered stop list)', () => {
    const m = parseGpx(GPX_ROUTE_ONLY);
    expect(m.name).toBe('Küstenroute');
    expect(m.stops.map((s) => s.name)).toEqual(['Stavanger', 'Bergen']);
    expect(m.tracks).toHaveLength(0);
  });

  it('throws on non-GPX input', () => {
    expect(() => parseGpx('<html></html>')).toThrow('GPX');
  });
});

describe('parseKml', () => {
  it('walks folders, maps Point -> stop and LineString -> track', () => {
    const m = parseKml(KML);
    expect(m.name).toBe('MyMaps Export');
    expect(m.stops).toHaveLength(1);
    expect(m.stops[0]).toMatchObject({ name: 'Bergen', lat: 60.3913, lng: 5.3221, notes: 'Hafen' });
    expect(m.tracks).toHaveLength(1);
    expect(m.tracks[0].points).toHaveLength(3);
    expect(m.tracks[0].points[2]).toEqual({ lat: 60.7, lng: 5.8, time: null, ele: 120 });
  });

  it('throws on non-KML input', () => {
    expect(() => parseKml('<gpx></gpx>')).toThrow('KML');
  });
});

describe('parseKmlCoordinates', () => {
  it('parses lng,lat[,alt] tuples and skips garbage', () => {
    expect(parseKmlCoordinates('5.32,60.39 x,y 6.15,62.47,10')).toEqual([
      { lat: 60.39, lng: 5.32, time: null, ele: null },
      { lat: 62.47, lng: 6.15, time: null, ele: 10 },
    ]);
  });
});

describe('round-trips', () => {
  const model: RouteModel = {
    name: 'Test & Reise', // & must survive XML escaping
    stops: [
      { name: 'Bergen', lat: 60.3913, lng: 5.3221, time: '2025-08-01T10:00:00Z', notes: 'Hafen' },
      { name: null, lat: 61, lng: 6, time: null, notes: null },
    ],
    tracks: [
      {
        name: 'Etappe 1',
        points: [
          { lat: 60.3913, lng: 5.3221, time: '2025-08-01T10:00:00Z', ele: 12.5 },
          { lat: 60.5, lng: 5.5, time: null, ele: null },
        ],
      },
    ],
  };

  it('GPX: parse(toGpx(m)) preserves stops and tracks', () => {
    expect(parseGpx(toGpx(model))).toEqual(model);
  });

  it('KML: parse(toKml(m)) preserves geometry (KML has no per-point time)', () => {
    const back = parseKml(toKml(model));
    expect(back.name).toBe(model.name);
    expect(back.stops.map(({ lat, lng, name }) => ({ lat, lng, name }))).toEqual(
      model.stops.map(({ lat, lng, name }) => ({ lat, lng, name })),
    );
    expect(back.tracks[0].points.map(({ lat, lng, ele }) => ({ lat, lng, ele }))).toEqual(
      model.tracks[0].points.map(({ lat, lng, ele }) => ({ lat, lng, ele })),
    );
  });
});

describe('detectRouteFormat / parseRouteFile', () => {
  it('detects by extension first, then by content', () => {
    expect(detectRouteFormat('tour.gpx', '')).toBe('gpx');
    expect(detectRouteFormat('export.KML', '')).toBe('kml');
    expect(detectRouteFormat('download.xml', GPX)).toBe('gpx');
    expect(detectRouteFormat('download.xml', KML)).toBe('kml');
    expect(detectRouteFormat('foto.jpg', 'binary')).toBeNull();
  });

  it('dispatches to the right parser', () => {
    expect(parseRouteFile('tour.gpx', GPX).stops).toHaveLength(2);
    expect(parseRouteFile('export.kml', KML).tracks).toHaveLength(1);
  });

  it('throws a German message for unknown formats', () => {
    expect(() => parseRouteFile('foto.jpg', 'xx')).toThrow('GPX und KML');
  });
});

describe('routeModelStats', () => {
  it('counts stops, tracks and track points', () => {
    expect(routeModelStats(parseGpx(GPX))).toEqual({ stops: 2, tracks: 1, trackPoints: 3 });
  });
});
