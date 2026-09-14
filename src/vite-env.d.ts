/// <reference types="vite/client" />

interface MIDIOptions {
  sysex?: boolean;
  software?: boolean;
}

interface MIDIMessageEvent extends Event {
  data: Uint8Array | null;
  timeStamp: number;
}

interface MIDIPort extends EventTarget {
  id: string;
  name?: string;
  manufacturer?: string;
  onmidimessage: ((event: MIDIMessageEvent) => void) | null;
}

interface MIDIInput extends MIDIPort {}

interface MIDIInputMap {
  values(): IterableIterator<MIDIInput>;
}

interface MIDIAccess extends EventTarget {
  inputs: MIDIInputMap;
  onstatechange: ((event: Event) => void) | null;
}

interface Navigator {
  requestMIDIAccess(options?: MIDIOptions): Promise<MIDIAccess>;
}
