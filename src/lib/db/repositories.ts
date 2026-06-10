/**
 * Offline-first repositories — the app's CRUD surface. Every mutation writes to
 * local SQLite first (Source of Truth, README §9.4); the sync engine replicates
 * to Supabase later. "Delete" is always a soft-delete (tombstone), never a hard
 * DELETE (README §5.4) — a real DSGVO hard-delete is a separate, explicit flow.
 */
import type { Photo, Stop, StopRole, StopType, Trip, UploadStatus } from '@/types/models';
import { newId, nowIso } from '@/lib/util/id';
import { insertRow, selectRowById, selectRows, updateRow } from './crud';
import { photoToRow, rowToPhoto, rowToStop, rowToTrip, stopToRow, tripToRow } from './mappers';

function newBase() {
  const ts = nowIso();
  return { id: newId(), createdAt: ts, updatedAt: ts, deletedAt: null };
}

async function softDelete(table: string, id: string): Promise<void> {
  const ts = nowIso();
  await updateRow(table, id, { deleted_at: ts, updated_at: ts });
}

// ── Trips ─────────────────────────────────────────────────────────────────────
export const tripRepo = {
  async list(): Promise<Trip[]> {
    return (await selectRows('trips')).map(rowToTrip);
  },
  async get(id: string): Promise<Trip | null> {
    const r = await selectRowById('trips', id);
    return r ? rowToTrip(r) : null;
  },
  async create(input: { name: string; ownerId: string; startDate?: string | null }): Promise<Trip> {
    const model: Trip = {
      ...newBase(),
      name: input.name,
      ownerId: input.ownerId,
      sharedWith: [],
      startDate: input.startDate ?? null,
      stravaUrl: null,
    };
    await insertRow('trips', tripToRow(model));
    return model;
  },
  async update(id: string, patch: Partial<Pick<Trip, 'name' | 'startDate' | 'stravaUrl'>>): Promise<void> {
    const row: Record<string, string | number | null> = { updated_at: nowIso() };
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.startDate !== undefined) row.start_date = patch.startDate;
    if (patch.stravaUrl !== undefined) row.strava_url = patch.stravaUrl;
    await updateRow('trips', id, row);
  },
  async rename(id: string, name: string): Promise<void> {
    await updateRow('trips', id, { name, updated_at: nowIso() });
  },
  async remove(id: string): Promise<void> {
    await softDelete('trips', id);
  },
};

// ── Stops ─────────────────────────────────────────────────────────────────────
export const stopRepo = {
  async listByTrip(tripId: string): Promise<Stop[]> {
    return (await selectRows('stops', 'trip_id = ?', [tripId], 'position ASC')).map(rowToStop);
  },
  async get(id: string): Promise<Stop | null> {
    const r = await selectRowById('stops', id);
    return r ? rowToStop(r) : null;
  },
  async create(input: {
    tripId: string;
    position: number;
    role: StopRole;
    name: string;
    lat: number;
    lng: number;
    type?: StopType | null;
    arrivalDate?: string | null;
    notes?: string | null;
  }): Promise<Stop> {
    const model: Stop = {
      ...newBase(),
      tripId: input.tripId,
      position: input.position,
      role: input.role,
      type: input.type ?? null,
      name: input.name,
      lat: input.lat,
      lng: input.lng,
      arrivalDate: input.arrivalDate ?? null,
      notes: input.notes ?? null,
    };
    await insertRow('stops', stopToRow(model));
    return model;
  },
  async update(
    id: string,
    patch: Partial<Pick<Stop, 'name' | 'type' | 'role' | 'position' | 'arrivalDate' | 'notes' | 'lat' | 'lng'>>,
  ): Promise<void> {
    const row: Record<string, string | number | null> = { updated_at: nowIso() };
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.type !== undefined) row.type = patch.type;
    if (patch.role !== undefined) row.role = patch.role;
    if (patch.position !== undefined) row.position = patch.position;
    if (patch.arrivalDate !== undefined) row.arrival_date = patch.arrivalDate;
    if (patch.notes !== undefined) row.notes = patch.notes;
    if (patch.lat !== undefined) row.lat = patch.lat;
    if (patch.lng !== undefined) row.lng = patch.lng;
    await updateRow('stops', id, row);
  },
  async remove(id: string): Promise<void> {
    await softDelete('stops', id);
  },
};

// ── Photos ────────────────────────────────────────────────────────────────────
export const photoRepo = {
  async listByStop(stopId: string): Promise<Photo[]> {
    return (await selectRows('photos', 'stop_id = ?', [stopId], 'taken_at ASC')).map(rowToPhoto);
  },
  async create(input: {
    stopId: string;
    localUri?: string | null;
    takenAt?: string | null;
    lat?: number | null;
    lng?: number | null;
  }): Promise<Photo> {
    const model: Photo = {
      ...newBase(),
      stopId: input.stopId,
      localUri: input.localUri ?? null,
      storageUrl: null,
      uploadStatus: 'pending',
      takenAt: input.takenAt ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
    };
    await insertRow('photos', photoToRow(model));
    return model;
  },
  async setUploaded(id: string, storageUrl: string): Promise<void> {
    await updateRow('photos', id, {
      storage_url: storageUrl,
      upload_status: 'uploaded' satisfies UploadStatus,
      updated_at: nowIso(),
    });
  },
  async setUploadStatus(id: string, status: UploadStatus): Promise<void> {
    await updateRow('photos', id, { upload_status: status, updated_at: nowIso() });
  },
  async remove(id: string): Promise<void> {
    await softDelete('photos', id);
  },
};
