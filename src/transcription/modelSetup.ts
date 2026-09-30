import {
  fetchMuScriptorStatus,
  muScriptorDevice,
  muScriptorStatusNow,
  resetMuScriptorProbe,
} from "../music/muscriptor";

export type ModelSetupStatus = "ready" | "missing" | "checking";

export type ModelSetupState = {
  status: ModelSetupStatus;
  muscriptorAvailable: boolean;
  device: "cpu" | "cuda" | null;
  isDesktop: boolean;
  steps: ModelSetupStep[];
};

export type ModelSetupStep = {
  id: string;
  label: string;
  done: boolean;
  action?: string;
};

function isDesktop(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

export function modelSetupSteps(): ModelSetupStep[] {
  return [
    {
      id: "python",
      label: "Python + MuScriptor environment",
      done: false,
      action: "Run scripts/setup-muscriptor.ps1 once",
    },
    {
      id: "hf",
      label: "Hugging Face login + model license",
      done: false,
      action: "Accept license at huggingface.co/MuScriptor/muscriptor-large",
    },
    {
      id: "model",
      label: "Download model weights (~5 GB)",
      done: false,
      action: "Run scripts/download-muscriptor-model.ps1",
    },
  ];
}

export async function checkModelSetup(): Promise<ModelSetupState> {
  resetMuScriptorProbe();
  const desktop = isDesktop();
  const status = await fetchMuScriptorStatus();
  const muscriptorAvailable = Boolean(status?.available);
  const device = muScriptorDevice();
  const modelReady = Boolean(status?.modelCached);
  const steps = modelSetupSteps().map((step) => {
    if (step.id === "python") return { ...step, done: muscriptorAvailable };
    if (step.id === "hf") return { ...step, done: modelReady };
    if (step.id === "model") return { ...step, done: modelReady };
    return step;
  });
  const ready = muscriptorAvailable && modelReady;
  return {
    status: ready ? "ready" : "missing",
    muscriptorAvailable,
    device,
    isDesktop: desktop,
    steps,
  };
}

export function modelSetupSummary(): string {
  const status = muScriptorStatusNow();
  if (!status?.available) return "MuScriptor not detected.";
  const model = status.model ?? "large";
  const mode = status.fast ? "fast" : "quality";
  const cache = status.modelCached ? "weights cached" : "weights not cached yet";
  const device = status.device === "cuda" ? "GPU" : status.device === "cpu" ? "CPU" : "device unknown";
  return `MuScriptor ${model} (${mode}, ${device}, ${cache}).`;
}
