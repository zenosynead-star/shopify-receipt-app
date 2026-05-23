import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import {
  shopReceiptSecret,
  verifyShopReceiptToken,
} from "../lib/receipt-token";

// 設定画面の iframe 用: 注文確認メールの見た目プレビュー (HTML)。
// サンプル注文 + 現在の DB 設定で構築。認証なし、k トークン検証。
// URL: /preview-email/{shop}?k={token}
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const shop = params.shop;
  const token = new URL(request.url).searchParams.get("k") ?? "";
  if (!shop) return new Response("Not found", { status: 404 });
  if (!verifyShopReceiptToken(shop, token)) {
    return new Response("Invalid token", { status: 403 });
  }

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const secret = shopReceiptSecret(shop);
  const companyName = settings?.companyName || "あなたのストア";
  const storeHandle = shop.replace(/\.myshopify\.com$/, "");

  // 領収書スニペット (実 HTML 版、サンプル order_id=9999)
  const receiptSnippet = `<div style="margin:32px 0;padding:16px;text-align:center;background:#f6f6f7;border-radius:6px;">
  <p style="margin:0 0 12px;font-size:14px;color:#202223;">
    領収書（適格請求書）をダウンロードいただけます
  </p>
  <a href="${appUrl}/r/${shop}/9999?k=${secret}"
     style="display:inline-block;background:#202223;color:#ffffff;padding:12px 28px;
            text-decoration:none;border-radius:4px;font-weight:600;font-size:14px;">
    領収書をダウンロード（PDF）
  </a>
</div>`;

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>注文確認メール プレビュー</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif;
    background: #f4f4f5; padding: 16px; margin: 0; color: #202223; }
  .email { max-width: 560px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .header { padding: 24px 24px 16px; text-align: center; border-bottom: 1px solid #e1e3e5; }
  .logo { font-size: 18px; font-weight: 700; letter-spacing: 0.5px; }
  .body { padding: 24px; }
  .greeting { font-size: 22px; font-weight: 700; margin: 0 0 16px; }
  .lead { font-size: 14px; line-height: 1.6; color: #6d7175; margin: 0 0 24px; }
  .order-info { background: #f6f6f7; padding: 14px 18px; border-radius: 6px; margin: 16px 0; font-size: 14px; }
  .order-info strong { font-size: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 16px 0; }
  th, td { padding: 10px 8px; text-align: left; border-bottom: 1px solid #e1e3e5; }
  th { font-weight: 600; background: #f6f6f7; }
  td.num, th.num { text-align: right; }
  .totals { margin-top: 16px; font-size: 14px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .grand { font-size: 18px; font-weight: 700; border-top: 2px solid #202223;
    padding-top: 8px; margin-top: 8px; }
  .footer { padding: 16px 24px; background: #f6f6f7; font-size: 11px; color: #6d7175; text-align: center; }
  .badge { display: inline-block; background: #ffea8a; color: #6e5400; padding: 2px 8px;
    border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 6px; }
</style>
</head>
<body>
<div class="email">
  <div class="header">
    <div class="logo">${escapeHtml(companyName)}</div>
  </div>
  <div class="body">
    <h1 class="greeting">ご注文ありがとうございます<span class="badge">プレビュー</span></h1>
    <p class="lead">山田 太郎 様、ご注文を承りました。発送準備が整い次第、改めてご連絡いたします。</p>

    <div class="order-info">
      <strong>注文 #9999</strong><br>
      ${new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" })}
    </div>

    <table>
      <thead>
        <tr><th>商品</th><th class="num">数量</th><th class="num">金額</th></tr>
      </thead>
      <tbody>
        <tr><td>サンプル商品 A (標準税率)</td><td class="num">2</td><td class="num">¥10,000</td></tr>
        <tr><td>サンプル食品 B (軽減税率)</td><td class="num">4</td><td class="num">¥8,000</td></tr>
      </tbody>
    </table>

    <div class="totals">
      <div class="row"><span>小計</span><span>¥18,000</span></div>
      <div class="row"><span>消費税 (10%対象)</span><span>¥1,000</span></div>
      <div class="row"><span>消費税 (8%対象)</span><span>¥640</span></div>
      <div class="row grand"><span>合計</span><span>¥19,640</span></div>
    </div>

    ${receiptSnippet}
  </div>
  <div class="footer">
    このメールは ${escapeHtml(storeHandle)}.myshopify.com から自動送信されています
  </div>
</div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
