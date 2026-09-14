import { muScriptorDevice, probeMuScriptor, resetMuScriptorProbe } from "../music/muscriptor";

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

export function modelSetupSteps(isDesktopApp: boolean): ModelSetupStep[] {
  if (!isDesktopApp) {
    return [
      { id: "browser", label: "Browser mode uses Basic Pitch (no install)", done: true },
      { id: "desktop", label: "Install the desktop app for MuScriptor quality", done: false },
    ];
  }
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
  const muscriptorAvailable = desktop ? await probeMuScriptor() : false;
  const device = muScriptorDevice();
  const steps = modelSetupSteps(desktop).map((step) => {
    if (step.id === "browser") return { ...step, done: true };
    if (muscriptorAvailable && (step.id === "python" || step.id === "hf" || step.id === "model")) {
      return { ...step, done: true };
    }
    return step;
  });
  return {
    status: muscriptorAvailable ? "ready" : desktop ? "missing" : "ready",
    muscriptorAvailable,
    device,
    isDesktop: desktop,
    steps,
  };
}
