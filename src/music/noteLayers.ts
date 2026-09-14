import type { SongLevel } from "./difficulty";
import { sourceNotesForLevel } from "./difficulty";
import { splitHands } from "./handSplit";
import type { Piece, TimedNote } from "./timed";
import { applyTileMode, type TileMode } from "./transcribe";

export function layerSource(piece: Piece) {
  return {
    voice: piece.voiceNotes,
    instruments: piece.instNotes,
    leftHand: piece.leftHandNotes,
    rightHand: piece.rightHandNotes,
    all: piece.fullNotes ?? piece.notes,
  };
}

/** Raw notes for the current tile layer (before Easy/Medium/Hard filtering). */
export function getEditableNotes(piece: Piece, tileMode: TileMode): TimedNote[] {
  return applyTileMode(layerSource(piece), tileMode).map((note) => ({ ...note }));
}

/** Notes shown in Review for the active difficulty level. */
export function getEditableNotesForLevel(piece: Piece, level: SongLevel): TimedNote[] {
  return sourceNotesForLevel(layerSource(piece), level, piece.notes).map((note) => ({ ...note }));
}

function matchesStem(note: TimedNote, stem: TimedNote[]): boolean {
  return stem.some(
    (ref) => ref.note === note.note && Math.abs(ref.start - note.start) < 0.1 && Math.abs(ref.duration - note.duration) < 0.15,
  );
}

/** Save review edits back onto the correct stems for each level. */
export function applyEditedNotesForLevel(piece: Piece, level: SongLevel, edited: TimedNote[]): Piece {
  const sorted = [...edited].sort((a, b) => a.start - b.start || a.note - b.note);
  const next: Piece = { ...piece };
  const voiceRef = piece.voiceNotes ?? [];
  const instRef = piece.instNotes ?? [];

  if (level === "easy") {
    next.voiceNotes = sorted;
    next.notes = sorted;
    return next;
  }

  next.fullNotes = sorted;
  next.voiceNotes = sorted.filter((note) => matchesStem(note, voiceRef));
  next.instNotes = sorted.filter((note) => !matchesStem(note, voiceRef) || matchesStem(note, instRef));
  if (next.instNotes.length === 0) {
    next.instNotes = sorted.filter((note) => !next.voiceNotes?.some((v) => v.note === note.note && Math.abs(v.start - note.start) < 0.06));
  }
  const hands = splitHands(next.instNotes.length ? next.instNotes : sorted);
  next.leftHandNotes = hands.left;
  next.rightHandNotes = hands.right;
  next.notes = sorted;
  return next;
}

/** Write edited notes back onto the piece and refresh derived hand layers. */
export function applyEditedNotes(piece: Piece, tileMode: TileMode, edited: TimedNote[]): Piece {
  const sorted = [...edited].sort((a, b) => a.start - b.start || a.note - b.note);
  const next: Piece = { ...piece };

  if (tileMode === "voice") {
    next.voiceNotes = sorted;
  } else if (tileMode === "left") {
    next.leftHandNotes = sorted;
  } else if (tileMode === "right") {
    next.rightHandNotes = sorted;
  } else if (tileMode === "instruments") {
    next.instNotes = sorted;
    const hands = splitHands(sorted);
    next.leftHandNotes = hands.left;
    next.rightHandNotes = hands.right;
  } else {
    next.fullNotes = sorted;
    if (!next.voiceNotes?.length || next.instNotes?.length) {
      next.instNotes = sorted;
    }
    const hands = splitHands(sorted);
    next.leftHandNotes = hands.left;
    next.rightHandNotes = hands.right;
  }

  next.notes = applyTileMode(layerSource(next), tileMode);
  return next;
}
