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

const ORDER_FIELDS = `#graphql
  id
  name
  processedAt
  customer { displayName }
  customAttributes { key value }
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
`;

// GraphQL レスポンスから日本円整数値に変換 (Shopify は文字列の小数)
function toJpyInt(amount: string | number | null | undefined): number {
  if (amount == null) return 0;
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return Math.round(n);
}

function normalizeOrder(order: any): ReceiptOrder {
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
    const net = lineItems
      .filter((li) => li.taxRate === rate)
      .reduce((s, li) => s + li.totalJpy, 0);
    taxByRate[rate] = { net, tax };
  }

  const numericId = order.id.replace("gid://shopify/Order/", "");

  // チェックアウト UI Extension で入力された領収書宛名があれば優先
  const receiptRecipient = (order.customAttributes ?? [])
    .find((a: any) => a.key === "receipt_recipient")
    ?.value?.trim();

  return {
    orderName: order.name,
    orderId: numericId,
    processedAt: order.processedAt,
    customerName:
      receiptRecipient || order.customer?.displayName || "ご注文者様",
    subtotalJpy: toJpyInt(order.currentSubtotalPriceSet.shopMoney.amount),
    taxByRate,
    totalJpy: toJpyInt(order.currentTotalPriceSet.shopMoney.amount),
    lineItems,
  };
}

/**
 * 注文を取得する。orderIdOrName が:
 *  - 数字のみ → Order ID (gid) として直接取得
 *  - その他 (#1001 等) → 注文名として orders(query:) で検索
 *
 * 注意: `read_orders` スコープでは過去 60 日の注文のみ取得可能。
 * それ以前の注文は `read_all_orders` (要承認) が必要。
 */
export async function fetchReceiptOrder(
  shop: string,
  orderIdOrName: string,
): Promise<ReceiptOrder | null> {
  const { admin } = await unauthenticated.admin(shop);
  const isNumericId = /^\d+$/.test(orderIdOrName);

  try {
    if (isNumericId) {
      // ID 直接取得
      const gid = `gid://shopify/Order/${orderIdOrName}`;
      const response = await admin.graphql(
        `#graphql
          query ReceiptOrderById($id: ID!) {
            order(id: $id) {
              ${ORDER_FIELDS}
            }
          }`,
        { variables: { id: gid } },
      );
      const json = (await response.json()) as {
        data?: { order: any | null };
        errors?: any[];
      };
      if (json.errors) {
        console.error(
          "[order-fetcher] GraphQL errors by ID:",
          JSON.stringify(json.errors),
        );
        return null;
      }
      if (!json.data?.order) {
        console.error(
          `[order-fetcher] Order not found by ID: shop=${shop} id=${orderIdOrName}. 60日より古い注文の可能性があります (要 read_all_orders スコープ)。`,
        );
        return null;
      }
      return normalizeOrder(json.data.order);
    } else {
      // 注文名で検索: "#" が無ければ補う
      const name = orderIdOrName.startsWith("#")
        ? orderIdOrName
        : `#${orderIdOrName}`;
      const response = await admin.graphql(
        `#graphql
          query ReceiptOrderByName($query: String!) {
            orders(first: 1, query: $query) {
              edges { node { ${ORDER_FIELDS} } }
            }
          }`,
        { variables: { query: `name:${name}` } },
      );
      const json = (await response.json()) as {
        data?: { orders: { edges: { node: any }[] } };
        errors?: any[];
      };
      if (json.errors) {
        console.error(
          "[order-fetcher] GraphQL errors by name:",
          JSON.stringify(json.errors),
        );
        return null;
      }
      const edge = json.data?.orders.edges[0];
      if (!edge) {
        console.error(
          `[order-fetcher] Order not found by name: shop=${shop} name=${name}. 60日より古い注文か注文名が間違っている可能性。`,
        );
        return null;
      }
      return normalizeOrder(edge.node);
    }
  } catch (e) {
    console.error("[order-fetcher] Exception:", e);
    return null;
  }
}
