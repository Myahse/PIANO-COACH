import type { MidiAdapter, MidiDevice, MidiEvent, MidiMessageHandler } from "./types";
import { WebMidiAdapter } from "./webMidiAdapter";


export class MidiService {
  private adapter: MidiAdapter;
  private listeners = new Set<MidiMessageHandler>();
  private unsubscribeAdapter: (() => void) | null = null;

  constructor(adapter: MidiAdapter = new WebMidiAdapter()) {
    this.adapter = adapter;
    this.bindAdapter();
  }

  get kind(): MidiAdapter["kind"] {
    return this.adapter.kind;
  }

  async connect(): Promise<MidiDevice[]> {
    await this.adapter.requestAccess();
    const devices = this.adapter.listInputs();
    if (devices[0] && !this.adapter.selectedInputId()) {
      this.adapter.selectInput(devices[0].id);
    }
    return this.listInputs();
  }

  listInputs(): MidiDevice[] {
    return this.adapter.listInputs();
  }

  selectInput(id: string): void {
    this.adapter.selectInput(id);
  }

  selectedInput(): MidiDevice | null {
    const id = this.adapter.selectedInputId();
    return this.listInputs().find((device) => device.id === id) ?? null;
  }

  onMessage(handler: MidiMessageHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  onDevicesChanged(handler: () => void): () => void {
    return this.adapter.onDevicesChanged(handler);
  }

  /** Used by the on-screen keyboard so lessons work without the EP-10 plugged in. */
  emit(event: MidiEvent): void {
    this.listeners.forEach((handler) => handler(event));
  }

  useAdapter(adapter: MidiAdapter): void {
    this.unsubscribeAdapter?.();
    this.adapter.disconnect();
    this.adapter = adapter;
    this.bindAdapter();
  }

  private bindAdapter(): void {
    this.unsubscribeAdapter = this.adapter.onMessage((event) => {
      this.listeners.forEach((handler) => handler(event));
    });
  }
}
