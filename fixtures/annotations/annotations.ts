/**
 * 주문을 처리한다.
 * @covi 결제 흐름
 * @covi-root
 * @covi-group orders/payment
 */
export async function processOrder(token: string, amount: number, items: number[]) {
  // @covi-call {"label":"결제 승인","args":{"token":"결제 토큰","amount":"최종 금액"}}
  await charge(token, amount);

  // @covi-call {"label":"모호"}
  const first = one(), second = two();

  // @covi-call {"label":"중복","args":{"amount":"중복 값"}}
  send(amount, amount);

  // @covi-call {"label":"spread","args":{"...items":"항목"}}
  sendAll(...items);

  // @covi-call {bad json}
  charge(token, amount);

  // @covi-call {"label":"고아"}
  const result = amount + 1;
  return result;
}

function charge(_token: string, _amount: number) {}
function one() { return 1; }
function two() { return 2; }
function send(_left: number, _right: number) {}
function sendAll(..._items: number[]) {}

/**
 * 화살표 함수 설명
 * @covi 화살표 흐름
 */
export const arrowFlow = () => one();
