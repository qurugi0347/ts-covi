import { inner as importedInner } from "./helper";

export async function outer(amount: number) {
  const calculated = importedInner(innerLocal(amount));
  await remoteCharge(calculated);
  return calculated;
}

function innerLocal(value: number) { return value * 2; }
