import crypto from "node:crypto";

const secret = () =>
  process.env.SHOPIFY_API_SECRET || "dev-secret-do-not-use-in-prod";

// ショップ単位の固定トークン。Liquid メールテンプレに埋め込めば
// すべての注文で使い回せる。SHOPIFY_API_SECRET から派生するので
// アプリ側で別途保存する必要なし。
export function shopReceiptSecret(shop: string): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`SHOP_RECEIPT:${shop}`)
    .digest("hex")
    .substring(0, 16);
}

export function verifyShopReceiptToken(shop: string, token: string): boolean {
  const expected = shopReceiptSecret(shop);
  if (expected.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
