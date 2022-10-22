"use strict";

export class State {
  activate(...args);
  deactivate(...args);
  update(delta, ...args);
  render(alpha, ...args);
}

export class NoopState extends State {
  activate() {}
  deactivate() {}
  update(delta) {}
  render(alpha) {}
}

export class Engine {
  args = [];
  delta = 0;
  lag = 0;
  fps = 60;
  frameDuration = 1000 / 60;
  previousTime = null;
  raf = null;
  running = false;
  state;

  constructor(fps = 60, initialState = new NoopState()) {
    this.fps = fps;
    this.frameDuration = 1000 / fps;
    this.state = initialState;
  }

  changeState(state, ...args) {
    this.state.deactivate();
    this.args.length = 0;
    this.args.push(...args)
    this.state = state;
    this.state.activate();
  }

  start() {
    this.running = true;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  _tick(time) {
    this.raf = requestAnimationFrame(this.tick);
    if (!this.previousTime) this.previousTime = time;
    this.delta = time - this.previousTime;
    if (this.delta > this.fps) this.delta = this.frameDuration;
    this.lag += this.delta;
    let updated = false;
    while (this.lag >= this.frameDuration) {
      this.state.update(this.delta, ...this.args);
      updated = true;
      this.lag -= this.frameDuration;
    }
    if (updated) {
      this.state.render(this.lag / this.frameDuration, ...this.args);
    }
    this.previousTime = time;
  }
}

