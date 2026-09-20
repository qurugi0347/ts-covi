type Service = { run(value: number): void };

export function control(service?: Service) {
  outer: for (let i = start(); keepGoing(i); i = next(i)) {
    if (i === 1) continue outer;
    service?.run(i);
    if (i > 3) break outer;
  }

  try {
    risky();
  } catch (error) {
    recover(error);
  } finally {
    cleanup();
  }

  const result = enabled() && choose() ? left() : right();
  return result;
  unreachable();
}

export function override() {
  try {
    return left();
  } finally {
    return right();
  }
  unreachable();
}

export function* unsupportedGenerator() {
  yield 1;
}

export function recursive(value: number): number {
  if (value <= 0) return 0;
  return recursive(value - 1);
}

function start() { return 0; }
function keepGoing(value: number) { return value < 5; }
function next(value: number) { return value + 1; }
function risky() {}
function recover(_error: unknown) {}
function cleanup() {}
function enabled() { return true; }
function choose() { return true; }
function left() { return 1; }
function right() { return 2; }
function unreachable() {}
