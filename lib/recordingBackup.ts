// FishFlow — respaldo local de la grabación en curso
// ─────────────────────────────────────────────────────────────────────────────
// El bug que esto evita: `SessionRecorder` de TherapyOS acumula todos los
// trozos en memoria y arma el archivo hasta que le das "Detener". Si iOS
// bloquea la pantalla a mitad de una sesión de 50 minutos, se pierde la
// grabación COMPLETA — no solo el tramo que faltaba.
//
// Aquí cada trozo se escribe en IndexedDB conforme llega. Si el navegador mata
// la pestaña, al volver a abrir la app se puede recuperar y subir lo grabado.

const DB_NAME = "therapyflow";
const STORE = "chunks";
const META = "meta";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { autoIncrement: true });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode,
               fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export type PendingRecording = { blob: Blob; ext: string; seconds: number; startedAt: number; scope: string };

export async function backupChunk(blob: Blob): Promise<void> {
  const db = await open();
  await tx(db, STORE, "readwrite", (s) => s.add(blob));
  db.close();
}

export async function markStart(ext: string, scope = "terapia"): Promise<void> {
  const db = await open();
  await tx(db, META, "readwrite", (s) => s.put({ ext, scope, startedAt: Date.now() }, "current"));
  db.close();
}

export async function clearBackup(): Promise<void> {
  const db = await open();
  await tx(db, STORE, "readwrite", (s) => s.clear());
  await tx(db, META, "readwrite", (s) => s.delete("current"));
  db.close();
}

/**
 * Devuelve la grabación interrumpida, si hay una que valga la pena rescatar.
 * `scope` separa las apps: el respaldo de Therapy Flow no debe aparecerle al
 * terapeuta en TherapyOS, aunque use el mismo navegador.
 */
export async function readBackup(scope = "terapia"): Promise<PendingRecording | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await open();
    const chunks = await tx<Blob[]>(db, STORE, "readonly", (s) => s.getAll() as IDBRequest<Blob[]>);
    const meta = await tx<{ ext?: string; scope?: string; startedAt?: number } | undefined>(
      db, META, "readonly", (s) => s.get("current"),
    );
    db.close();
    if (!chunks?.length) return null;
    if ((meta?.scope ?? "terapia") !== scope) return null;
    const ext = meta?.ext ?? "webm";
    const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/mp4" });
    const startedAt = meta?.startedAt ?? Date.now();
    // Sin duración real: la estimamos por el tiempo transcurrido desde el inicio.
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    if (blob.size < 30_000) { await clearBackup(); return null; } // ruido, no una sesión
    return { blob, ext, seconds, startedAt, scope: meta?.scope ?? scope };
  } catch (e) {
    console.error("[recordingBackup] no se pudo leer el respaldo:", e);
    return null;
  }
}
