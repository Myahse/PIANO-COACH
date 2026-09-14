import type { Piece, TimedNote } from "./timed";

const DB_NAME = "piano-coach-library";
const STORE = "pieces";

type LibraryRecord = {
  id: string;
  title: string;
  source: "midi" | "musicxml" | "audio";
  notes: TimedNote[];
  fullNotes?: TimedNote[];
  voiceNotes?: TimedNote[];
  instNotes?: TimedNote[];
  leftHandNotes?: TimedNote[];
  rightHandNotes?: TimedNote[];
  audioBytes?: ArrayBuffer;
  audioType?: string;
  audioOffset?: number;
  audioDurationSec?: number;
  savedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the song library."));
  });
}

function runStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Library request failed."));
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("Library transaction failed."));
        };
      }),
  );
}

async function decodeAudio(bytes: ArrayBuffer): Promise<AudioBuffer | undefined> {
  try {
    const context = new AudioContext();
    const audio = await context.decodeAudioData(bytes.slice(0));
    void context.close();
    return audio;
  } catch {
    return undefined;
  }
}

export async function listLibraryPieces(): Promise<Piece[]> {
  const records = await runStore("readonly", (store) => store.getAll() as IDBRequest<LibraryRecord[]>);
  const sorted = [...records].sort((a, b) => b.savedAt - a.savedAt);
  const pieces: Piece[] = [];
  for (const record of sorted) {
    const audio = record.audioBytes ? await decodeAudio(record.audioBytes) : undefined;
    pieces.push({
      id: record.id,
      title: record.title,
      source: record.source,
      notes: record.notes,
      fullNotes: record.fullNotes,
      voiceNotes: record.voiceNotes,
      instNotes: record.instNotes,
      leftHandNotes: record.leftHandNotes,
      rightHandNotes: record.rightHandNotes,
      audio,
      audioOffset: record.audioOffset,
      audioDurationSec: record.audioDurationSec ?? audio?.duration,
      savedAt: record.savedAt,
    });
  }
  return pieces;
}

export async function saveLibraryPiece(piece: Piece, audioBytes?: ArrayBuffer, audioType?: string): Promise<void> {
  const previous = (await runStore("readonly", (store) => store.get(piece.id))) as LibraryRecord | undefined;
  const record: LibraryRecord = {
    id: piece.id,
    title: piece.title,
    source: piece.source === "builtin" ? "midi" : piece.source,
    notes: piece.notes,
    fullNotes: piece.fullNotes ?? previous?.fullNotes,
    voiceNotes: piece.voiceNotes ?? previous?.voiceNotes,
    instNotes: piece.instNotes ?? previous?.instNotes,
    leftHandNotes: piece.leftHandNotes ?? previous?.leftHandNotes,
    rightHandNotes: piece.rightHandNotes ?? previous?.rightHandNotes,
    audioBytes: audioBytes ?? previous?.audioBytes,
    audioType: audioType ?? previous?.audioType,
    audioOffset: piece.audioOffset ?? previous?.audioOffset,
    audioDurationSec: piece.audioDurationSec ?? piece.audio?.duration ?? previous?.audioDurationSec,
    savedAt: Date.now(),
  };
  await runStore("readwrite", (store) => store.put(record));
}

export async function getLibraryAudioBytes(id: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  const record = (await runStore("readonly", (store) => store.get(id))) as LibraryRecord | undefined;
  if (!record?.audioBytes) return null;
  return { bytes: record.audioBytes, type: record.audioType ?? "audio/mpeg" };
}

export async function deleteLibraryPiece(id: string): Promise<void> {
  await runStore("readwrite", (store) => store.delete(id));
}

export async function clearLibrary(): Promise<void> {
  await runStore("readwrite", (store) => store.clear());
  localStorage.removeItem("piano-coach-last-piece");
}

const WIPE_KEY = "piano-coach-library-wipe-v3";

export async function wipeOldLibraryOnce(): Promise<void> {
  if (localStorage.getItem(WIPE_KEY) === "1") return;
  await clearLibrary();
  localStorage.setItem(WIPE_KEY, "1");
}
