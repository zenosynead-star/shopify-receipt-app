import type { LoaderFunctionArgs } from "@remix-run/node";
import { renderToBuffer } from "@react-pdf/renderer";
import prisma from "../db.server";
import { fetchReceiptOrder } from "../lib/order-fetcher";
import { ReceiptDocument } from "../lib/receipt-pdf";
import { verifyShopReceiptToken } from "../lib/receipt-token";

// メールに埋め込まれるリンク: /r/{shop}/{orderId}?k={token}
// 顧客が直接アクセスする想定のため認証なし。トークンで照合。

function errorPage(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',sans-serif;background:#f4f4f5;padding:40px 20px;margin:0;color:#202223;}
.box{max-width:520px;margin:40px auto;background:white;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);}
h1{font-size:20px;margin:0 0 16px;color:#202223;}
p{font-size:14px;line-height:1.7;color:#6d7175;margin:0 0 16px;}
code{background:#f6f6f7;padding:2px 6px;border-radius:3px;font-size:13px;}
.icon{font-size:36px;margin-bottom:8px;}</style></head>
<body><div class="box"><div class="icon">⚠️</div><h1>${title}</h1><p>${bodyHtml}</p></div></body></html>`;
}

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const shop = params.shop;
  const orderId = params.orderId?.replace(/\.pdf$/, "");
  const token = new URL(request.url).searchParams.get("k") ?? "";

  if (!shop || !orderId) {
    return new Response("Not found", { status: 404 });
  }
  if (!verifyShopReceiptToken(shop, token)) {
    return new Response("Invalid token", { status: 403 });
  }

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    return new Response(errorPage("発行者情報が未登録です", `このストア (<code>${shop}</code>) には、まだ会社名・登録番号などの発行者情報が登録されていません。<br/><br/>ストア管理者の方は、Shopify Admin の <b>アプリ → 領収書生成</b> から設定画面を開き、必要項目を入力して <b>「保存」</b> ボタンを押してください。保存後に再度このリンクをクリックすると領収書がダウンロードできます。`), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const order = await fetchReceiptOrder(shop, orderId);
  if (!order) {
    return new Response(errorPage("ご注文が見つかりません", `注文 ID <code>${orderId}</code> が確認できませんでした。<br/><br/>考えられる原因:<br/>・注文が <b>過去 60 日</b> より古い (Shopify の仕様で取得不可)<br/>・URL が正しくない / 改ざんされた<br/><br/>お手数ですがストア管理者にお問い合わせください。`), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const buffer = await renderToBuffer(
    <ReceiptDocument
      order={order}
      issuer={{
        companyName: settings.companyName,
        invoiceNumber: settings.invoiceNumber,
        postalCode: settings.postalCode,
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        stampImageBase64: settings.stampImageBase64,
        receiptPrefix: settings.receiptPrefix,
        notes: settings.notes,
      }}
    />,
  );

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="receipt-${order.orderName.replace("#", "")}.pdf"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
};
