type Service = { run(value: number): void };
type NestedService = { child: { run(): void } };
type ServiceMap = Record<string, () => void>;

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
  enabled() || cleanup();
  service ?? cleanup();
  const callback: (() => void) | undefined = service ? cleanup : undefined;
  callback?.();
  void hidden();
  let attempts = 0;
  do {
    attempts++;
  } while (attempts < 1);
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

export function optionalChains(nested?: NestedService, services?: ServiceMap) {
  services?.[serviceKey()]();
  nested?.child.run();
  const selected = services?.[serviceKey()];
  return selected;
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
function hidden() {}
function serviceKey() { return "primary"; }
