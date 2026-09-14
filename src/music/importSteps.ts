export type ImportStepId = "received" | "processing" | "detecting" | "score";

export type ImportStep = {
  id: ImportStepId;
  label: string;
};

export const IMPORT_STEPS: ImportStep[] = [
  { id: "received", label: "File Received" },
  { id: "processing", label: "Processing Audio" },
  { id: "detecting", label: "Detecting Notes" },
  { id: "score", label: "Creating Score" },
];

export type ImportProgressUpdate = {
  pct: number;
  step: ImportStepId;
  detail?: string;
};

const STEP_ORDER: ImportStepId[] = ["received", "processing", "detecting", "score"];

export function stepIndex(step: ImportStepId): number {
  return STEP_ORDER.indexOf(step);
}

/** Map raw progress + label into Songscription-style steps. */
export function resolveImportProgress(pct: number, label?: string): ImportProgressUpdate {
  const text = (label ?? "").toLowerCase();
  let step: ImportStepId = "received";

  if (
    text.includes("saving") ||
    text.includes("creating") ||
    text.includes("finishing") ||
    text.includes("done") ||
    text.includes("score") ||
    text.includes("library") ||
    pct >= 90
  ) {
    step = "score";
  } else if (
    text.includes("muscriptor") ||
    text.includes("detect") ||
    text.includes("decod") ||
    text.includes("viterbi") ||
    text.includes("melody") ||
    text.includes("midi") ||
    text.includes("notes") ||
    (pct >= 24 && pct < 90)
  ) {
    step = "detecting";
  } else if (
    text.includes("prepar") ||
    text.includes("analyz") ||
    text.includes("loading") ||
    text.includes("audio") ||
    text.includes("resample") ||
    text.includes("isolat") ||
    text.includes("separat") ||
    text.includes("stem") ||
    text.includes("cleaning midi") ||
    text.includes("assigning hands") ||
    (pct >= 5 && pct < 24)
  ) {
    step = "processing";
  } else if (pct >= 2) {
    step = "processing";
  }

  const detail = label?.replace(/\s+\d+%$/, "").trim();
  return { pct, step, detail: detail || undefined };
}
