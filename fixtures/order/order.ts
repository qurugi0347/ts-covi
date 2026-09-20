type OrderItem = { sku: string; price: number; quantity: number };
type Order = { id: string; total: number };

/**
 * 주문 생성 흐름
 * @covi-root
 * @covi-group order/create
 */
export async function createOrder(items: OrderItem[], token: string): Promise<Order> {
  validateItems(items);
  await reserveStock(items);
  const total = calculateTotal(items);
  // @covi-call {"label":"결제 승인","args":{"token":"결제 토큰","total":"주문 합계"}}
  await approvePayment(token, total);
  const order = saveOrder(total);
  await notifyOrder(order.id);
  return order;
}

function validateItems(items: OrderItem[]) {
  if (items.length === 0) throw new Error("empty order");
}

async function reserveStock(_items: OrderItem[]) {}
function calculateTotal(items: OrderItem[]) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
async function approvePayment(_token: string, _total: number) {}
function saveOrder(total: number): Order { return { id: "order-1", total }; }
async function notifyOrder(_orderId: string) {}
