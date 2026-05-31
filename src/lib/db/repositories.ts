/**
 * Offline-first repositories — the app's CRUD surface. Every mutation writes to
 * local SQLite first (Source of Truth, README §9.4); the sync engine replicates
 * to Supabase later. "Delete" is always a soft-delete (tombstone), never a hard
 * DELETE (README §5.4) — a real DSGVO hard-delete is a separate, explicit flow.
 */
import type { Photo, Roadbook, Route, Stop, StopRole, StopType, UploadStatus } from '@/types/models';
import { newId, nowIso } from '@/lib/util/id';
import { insertRow, selectRowById, selectRows, updateRow } from './crud';
import {
  photoToRow,
  roadbookToRow,
  routeToRow,
  rowToPhoto,
  rowToRoadbook,
  rowToRoute,
  rowToStop,
  stopToRow,
} from './mappers';

function newBase() {
  const ts = nowIso();
  return { id: newId(), createdAt: ts, updatedAt: ts, deletedAt: null };
}

async function softDelete(table: string, id: string): Promise<void> {
  const ts = nowIso();
  await updateRow(table, id, { deleted_at: ts, updated_at: ts });
}

// ── Roadbooks ─────────────────────────────────────────────────────────────────
export const roadbookRepo = {
  async list(): Promise<Roadbook[]> {
    return (await selectRows('roadbooks')).map(rowToRoadbook);
  },
  async get(id: string): Promise<Roadbook | null> {
    const r = await selectRowById('roadbooks', id);
    return r ? rowToRoadbook(r) : null;
  },
  async create(input: { name: string; ownerId: string }): Promise<Roadbook> {
    const model: Roadbook = { ...newBase(), name: input.name, ownerId: input.ownerId, sharedWith: [] };
    await insertRow('roadbooks', roadbookToRow(model));
    return model;
  },
  async rename(id: string, name: string): Promise<void> {
    await updateRow('roadbooks', id, { name, updated_at: nowIso() });
  },
  async remove(id: string): Promise<void> {
    await softDelete('roadbooks', id);
  },
};

// ── Routes ────────────────────────────────────────────────────────────────────
export const routeRepo = {
  async listByRoadbook(roadbookId: string): Promise<Route[]> {
    return (await selectRows('routes', 'roadbook_id = ?', [roadbookId])).map(rowToRoute);
  },
  async get(id: string): Promise<Route | null> {
    const r = await selectRowById('routes', id);
    return r ? rowToRoute(r) : null;
  },
  async create(input: { roadbookId: string; title: string; startDate?: string | null }): Promise<Route> {
    const model: Route = {
      ...newBase(),
      roadbookId: input.roadbookId,
      title: input.title,
      startDate: input.startDate ?? null,
    };
    await insertRow('routes', routeToRow(model));
    return model;
  },
  async update(id: string, patch: Partial<Pick<Route, 'title' | 'startDate'>>): Promise<void> {
    const row: Record<string, string | number | null> = { updated_at: nowIso() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.startDate !== undefined) row.start_date = patch.startDate;
    await updateRow('routes', id, row);
  },
  async remove(id: string): Promise<void> {
    await softDelete('routes', id);
  },
};

// ── Stops ─────────────────────────────────────────────────────────────────────
export const stopRepo = {
  async listByRoute(routeId: string): Promise<Stop[]> {
    return (await selectRows('stops', 'route_id = ?', [routeId], 'position ASC')).map(rowToStop);
  },
  async get(id: string): Promise<Stop | null> {
    const r = await selectRowById('stops', id);
    return r ? rowToStop(r) : null;
  },
  async create(input: {
    routeId: string;
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
      routeId: input.routeId,
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
