// Anything that needs the time asks a Clock instead of calling `new Date()`,
// so tests can supply one they control.
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now() {
    return new Date();
  }
}
