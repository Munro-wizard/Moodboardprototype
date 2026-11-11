import {
  CATEGORIES,
  type Brief,
  type Caps,
  type ImageRecord,
  DEFAULT_CAPS,
  LEGACY_CAPS,
  emptyBrief,
  sameCaps,
} from "./types";

const DB_NAME = "fourwords-brief";
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;
let loadInflight: Promise<{
  caps: Caps;
  images: ImageRecord[];
  briefs: Brief[];
  brief: Brief;
}> | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        if (event.oldVersion < 1) {
          const kv = db.createObjectStore("kv");
          db.createObjectStore("images", { keyPath: "id" });
          db.createObjectStore("briefs", { keyPath: "id" });
          kv.put(DEFAULT_CAPS, "caps");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

async function getAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(store, "readonly");
  const rows = await request<T[]>(tx.objectStore(store).getAll());
  await transactionDone(tx);
  return rows;
}

async function putStore(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  if (key === undefined) tx.objectStore(store).put(value);
  else tx.objectStore(store).put(value, key);
  await transactionDone(tx);
}

export async function saveBrief(brief: Brief): Promise<void> {
  await putStore("briefs", brief);
}

export async function saveCaps(caps: Caps): Promise<void> {
  await putStore("kv", caps, "caps");
}

export async function addImage(image: ImageRecord): Promise<void> {
  await putStore("images", image);
}

export async function deleteImage(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("images", "readwrite");
  tx.objectStore("images").delete(id);
  await transactionDone(tx);
}

async function deleteBrief(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("briefs", "readwrite");
  tx.objectStore("briefs").delete(id);
  await transactionDone(tx);
}

function richness(brief: Brief): number {
  const picks = Object.values(brief.selections).reduce(
    (sum, ids) => sum + ids.filter(Boolean).length,
    0,
  );
  const notes = Object.values(brief.notes).filter((note) => note.trim()).length;
  return picks + notes + (brief.clientName.trim() ? 1 : 0) + (brief.metal ? 1 : 0);
}

export function load() {
  if (!loadInflight) {
    loadInflight = loadOnce().finally(() => {
      loadInflight = null;
    });
  }
  return loadInflight;
}

async function loadOnce() {
  const [caps, images, briefs] = await Promise.all([
    (async () => {
      const db = await openDb();
      const tx = db.transaction("kv", "readonly");
      const stored = await request<Caps | undefined>(tx.objectStore("kv").get("caps"));
      await transactionDone(tx);
      const storedCaps = stored ?? DEFAULT_CAPS;
      if (sameCaps(storedCaps, LEGACY_CAPS)) {
        await saveCaps(DEFAULT_CAPS);
        return DEFAULT_CAPS;
      }
      return storedCaps;
    })(),
    getAll<ImageRecord>("images"),
    getAll<Brief>("briefs"),
  ]);
  for (let i = images.length - 1; i >= 0; i -= 1) {
    if (!images[i].id.startsWith("seed-")) continue;
    await deleteImage(images[i].id);
    images.splice(i, 1);
  }
  for (const item of briefs) {
    let changed = false;
    const selections = { ...item.selections };
    for (const category of CATEGORIES) {
      const before = selections[category.id] ?? [];
      const after = before.map((id) => (id && id.startsWith("seed-") ? null : id));
      if (after.some((id, index) => id !== before[index])) {
        selections[category.id] = after;
        changed = true;
      }
    }
    if (changed) {
      item.selections = selections;
      await saveBrief(item);
    }
  }
  const drafts = briefs.filter((item) => item.status === "draft");
  if (drafts.length > 1) {
    const ranked = [...drafts].sort(
      (a, b) => richness(b) - richness(a) || b.createdAt - a.createdAt,
    );
    for (const extra of ranked.slice(1)) {
      await deleteBrief(extra.id);
      const index = briefs.findIndex((item) => item.id === extra.id);
      if (index >= 0) briefs.splice(index, 1);
    }
  }
  let brief = briefs.find((item) => item.status === "draft") ?? null;
  if (!brief) {
    brief =
      briefs
        .filter((item) => item.status === "locked")
        .sort((a, b) => (b.lockedAt ?? 0) - (a.lockedAt ?? 0))[0] ?? null;
  }
  if (!brief) {
    brief = emptyBrief();
    await saveBrief(brief);
    briefs.push(brief);
  }
  return { caps, images, briefs, brief };
}
