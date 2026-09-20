export class WorkerLifecycle {
  running = false;
  draining = false;
  private lastProgress: number;
  private current: Promise<void> | undefined;
  constructor(
    private task: () => Promise<void>,
    private clock: () => number = Date.now,
  ) {
    this.lastProgress = clock();
  }
  ready() {
    return !this.draining && this.clock() - this.lastProgress <= 600000;
  }
  tick() {
    if (this.draining || this.running) return Promise.resolve();
    this.running = true;
    this.current = (async () => {
      try {
        await this.task();
      } finally {
        this.lastProgress = this.clock();
        this.running = false;
      }
    })();
    return this.current;
  }
  async drain() {
    this.draining = true;
    await this.current;
  }
}
