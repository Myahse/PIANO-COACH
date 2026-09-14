import { parseMidiMessage } from "./parse";
import type { MidiAdapter, MidiDevice, MidiMessageHandler } from "./types";

function toDevice(input: MIDIInput): MidiDevice {
  return {
    id: input.id,
    name: input.name ?? "MIDI keyboard",
    manufacturer: input.manufacturer ?? "",
  };
}

export class WebMidiAdapter implements MidiAdapter {
  readonly kind = "usb" as const;
  private access: MIDIAccess | null = null;
  private selectedId: string | null = null;
  private handlers = new Set<MidiMessageHandler>();
  private deviceHandlers = new Set<() => void>();

  async requestAccess(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      throw new Error("This browser cannot use USB MIDI. Open Chrome or Edge on the desktop.");
    }

    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => {
      this.attachSelected();
      this.deviceHandlers.forEach((handler) => handler());
    };
    this.attachSelected();
  }

  listInputs(): MidiDevice[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map(toDevice);
  }

  selectInput(id: string | null): void {
    this.selectedId = id;
    this.attachSelected();
  }

  selectedInputId(): string | null {
    return this.selectedId;
  }

  onMessage(handler: MidiMessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onDevicesChanged(handler: () => void): () => void {
    this.deviceHandlers.add(handler);
    return () => this.deviceHandlers.delete(handler);
  }

  disconnect(): void {
    this.clearInputHandlers();
    this.access = null;
    this.selectedId = null;
  }

  private attachSelected(): void {
    if (!this.access) return;
    this.clearInputHandlers();

    const inputs = [...this.access.inputs.values()];
    if (inputs.length === 0) {
      this.selectedId = null;
      return;
    }

    const selected =
      inputs.find((input) => input.id === this.selectedId) ??
      inputs.find((input) => /eastar|ep-?10|eb2000/i.test(`${input.name} ${input.manufacturer}`)) ??
      inputs[0];

    if (!selected) return;
    this.selectedId = selected.id;
    selected.onmidimessage = (event) => {
      const bytes = event.data ? new Uint8Array(event.data) : new Uint8Array();
      const parsed = parseMidiMessage(bytes, event.timeStamp);
      if (parsed) this.handlers.forEach((handler) => handler(parsed));
    };
  }

  private clearInputHandlers(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = null;
    }
  }
}
