import type { Envelope } from './envelope.js';

/**
 * The sink the kernel exits through. Concrete human/JSON renderers (output-port.ts
 * § T008) implement this; defining it here keeps `exit.ts` free of renderer details.
 */
export interface OutputPort {
  emit(env: Envelope): void;
}
