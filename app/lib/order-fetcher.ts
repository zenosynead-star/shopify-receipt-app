import { unauthenticated } from "../shopify.server";

export type ReceiptLineItem = {
  title: string;
  quantity: number;
  unitPriceJpy: number;
  totalJpy: number;
  taxRate: number; // 10 or 8
};

export type ReceiptOrder = {
  orderName: string; // "#1001"
  orderId: string;
  processedAt: string; // ISO
  customerName: string;
  subtotalJpy: number;
  taxByRate: Record<number, { net: number; tax: number }>; // {10: {net, tax}, 8: {...}}
  totalJpy: number;
  lineItems: ReceiptLineItem[];
};

// GraphQL レスポンスから日本円整数値に変換 (Shopify は文字列の小数)
function toJpyInt(amount: string | number | null | undefined): number {
  if (amount == null) return 0;
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return Math.round(n);
}

export async function fetchReceiptOrder(
  shop: string,
  orderIdNumeric: string,
): Promise<ReceiptOrder | null> {
  const { admin } = await unauthenticated.admin(shop);
  const gid = `gid://shopify/Order/${orderIdNumeric}`;

  const response = await admin.graphql(
    `#graphql
      query ReceiptOrder($id: ID!) {
        order(id: $id) {
          id
          name
          processedAt
          customer { displayName }
          currentSubtotalPriceSet { shopMoney { amount } }
          currentTotalPriceSet { shopMoney { amount } }
          currentTotalTaxSet { shopMoney { amount } }
          currentTaxLines { rate priceSet { shopMoney { amount } } }
          lineItems(first: 100) {
            edges {
              node {
                title
                quantity
                originalUnitPriceSet { shopMoney { amount } }
                discountedTotalSet { shopMoney { amount } }
                taxLines { rate }
              }
            }
          }
        }
      }`,
    { variables: { id: gid } },
  );

  const json = (await response.json()) as {
    data?: { order: any | null };
  };
  const order = json.data?.order;
  if (!order) return null;

  const lineItems: ReceiptLineItem[] = order.lineItems.edges.map(
    (edge: any) => {
      const node = edge.node;
      const rate = Math.round((node.taxLines?.[0]?.rate ?? 0.1) * 100);
      return {
        title: node.title,
        quantity: node.quantity,
        unitPriceJpy: toJpyInt(node.originalUnitPriceSet.shopMoney.amount),
        totalJpy: toJpyInt(node.discountedTotalSet.shopMoney.amount),
        taxRate: rate,
      };
    },
  );

  const taxByRate: Record<number, { net: number; tax: number }> = {};
  for (const tl of order.currentTaxLines ?? []) {
    const rate = Math.round(tl.rate * 100);
    const tax = toJpyInt(tl.priceSet.shopMoney.amount);
    // この税率の課税対象金額 (net) は line items から逆算
    const net = lineItems
      .filter((li) => li.taxRate === rate)
      .reduce((s, li) => s + li.totalJpy, 0);
    taxByRate[rate] = { net, tax };
  }

  return {
    orderName: order.name,
    orderId: orderIdNumeric,
    processedAt: order.processedAt,
    customerName: order.customer?.displayName ?? "ご注文者様",
    subtotalJpy: toJpyInt(order.currentSubtotalPriceSet.shopMoney.amount),
    taxByRate,
    totalJpy: toJpyInt(order.currentTotalPriceSet.shopMoney.amount),
    lineItems,
  };
}
