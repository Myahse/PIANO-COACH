export type MidiNoteEvent = {
  type: "noteon" | "noteoff";
  note: number;
  velocity: number;
  timestamp: number;
};

export type MidiControlEvent = {
  type: "control";
  controller: number;
  value: number;
  timestamp: number;
};

export type MidiEvent = MidiNoteEvent | MidiControlEvent;

export type MidiDevice = {
  id: string;
  name: string;
  manufacturer: string;
};

export type MidiMessageHandler = (event: MidiEvent) => void;

export interface MidiAdapter {
  readonly kind: "usb" | "bluetooth" | "virtual";
  requestAccess(): Promise<void>;
  listInputs(): MidiDevice[];
  selectInput(id: string | null): void;
  selectedInputId(): string | null;
  onMessage(handler: MidiMessageHandler): () => void;
  onDevicesChanged(handler: () => void): () => void;
  disconnect(): void;
}
