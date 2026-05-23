import type { LoaderFunctionArgs } from "@remix-run/node";
import { renderToBuffer } from "@react-pdf/renderer";
import prisma from "../db.server";
import { fetchReceiptOrder } from "../lib/order-fetcher";
import { ReceiptDocument } from "../lib/receipt-pdf";
import { verifyShopReceiptToken } from "../lib/receipt-token";

// メールに埋め込まれるリンク: /r/{shop}/{orderId}?k={token}
// 顧客が直接アクセスする想定のため認証なし。トークンで照合。
//
// 動作モード:
//   ?k={token}                      → 宛名確認ページ (HTML)
//   ?k={token}&download=1&name=...  → 領収書 PDF を生成・返却

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

function confirmPage(
  orderName: string,
  defaultName: string,
  companyName: string,
  totalJpy: number,
): string {
  const yen = `¥${totalJpy.toLocaleString("ja-JP")}`;
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>領収書ダウンロード</title>
<style>
*{box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',sans-serif;background:#f4f4f5;padding:24px 16px;margin:0;color:#202223;line-height:1.6;}
.box{max-width:480px;margin:24px auto;background:white;border-radius:12px;padding:32px 28px;box-shadow:0 2px 8px rgba(0,0,0,0.08);}
.brand{font-size:12px;color:#6d7175;letter-spacing:1px;margin-bottom:4px;}
h1{font-size:22px;margin:0 0 8px;}
.summary{background:#f6f6f7;border-radius:8px;padding:14px 16px;margin:20px 0;font-size:14px;}
.summary .row{display:flex;justify-content:space-between;padding:3px 0;}
.summary .label{color:#6d7175;}
label{display:block;margin:24px 0 6px;font-size:13px;font-weight:600;}
input[type=text]{width:100%;padding:12px 14px;border:1px solid #c9cccf;border-radius:6px;font-size:16px;font-family:inherit;}
input[type=text]:focus{outline:none;border-color:#202223;box-shadow:0 0 0 2px rgba(0,0,0,0.05);}
.hint{font-size:12px;color:#6d7175;margin:6px 0 0;}
button{width:100%;background:#202223;color:white;border:none;padding:14px;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer;margin-top:24px;font-family:inherit;}
button:hover{background:#000;}
button:active{transform:scale(0.99);}
.icon{font-size:32px;margin-bottom:8px;}
</style></head>
<body>
<div class="box">
  <div class="brand">${escapeHtml(companyName)}</div>
  <h1>📄 領収書ダウンロード</h1>
  <p style="margin:0;font-size:14px;color:#6d7175;">下記内容で領収書 (PDF) を発行します。宛名は変更できます。</p>

  <div class="summary">
    <div class="row"><span class="label">注文番号</span><span><b>${escapeHtml(orderName)}</b></span></div>
    <div class="row"><span class="label">合計金額</span><span><b>${yen}</b></span></div>
  </div>

  <form method="GET" action="">
    <input type="hidden" name="download" value="1" />
    <label for="name">領収書の宛名</label>
    <input id="name" type="text" name="name" value="${escapeHtml(defaultName)}" placeholder="ご注文者名" autocomplete="organization" />
    <p class="hint">会社名や任意の名前に変更可能。空欄なら「ご注文者様」と表示されます。</p>
    <button type="submit">PDF をダウンロード</button>
  </form>
</div>
<script>
// k トークンを自動で hidden に追加
(function(){
  var u = new URL(location.href);
  var k = u.searchParams.get('k');
  if (k) {
    var h = document.createElement('input');
    h.type = 'hidden'; h.name = 'k'; h.value = k;
    document.querySelector('form').appendChild(h);
  }
})();
</script>
</body></html>`;
}

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = params.shop;
  const orderId = params.orderId?.replace(/\.pdf$/, "");
  const token = url.searchParams.get("k") ?? "";
  const isDownload = url.searchParams.get("download") === "1";
  const customName = url.searchParams.get("name")?.trim() || "";

  if (!shop || !orderId) {
    return new Response("Not found", { status: 404 });
  }
  if (!verifyShopReceiptToken(shop, token)) {
    return new Response("Invalid token", { status: 403 });
  }

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    return new Response(
      errorPage(
        "発行者情報が未登録です",
        `このストア (<code>${shop}</code>) には、まだ会社名・登録番号などの発行者情報が登録されていません。<br/><br/>ストア管理者の方は、Shopify Admin の <b>アプリ → 領収書生成</b> から設定画面を開き、必要項目を入力して <b>「保存」</b> ボタンを押してください。`,
      ),
      {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  const order = await fetchReceiptOrder(shop, orderId);
  if (!order) {
    return new Response(
      errorPage(
        "ご注文が見つかりません",
        `注文 ID <code>${orderId}</code> が確認できませんでした。<br/><br/>考えられる原因:<br/>・注文が <b>過去 60 日</b> より古い (Shopify の仕様で取得不可)<br/>・URL が正しくない / 改ざんされた<br/><br/>お手数ですがストア管理者にお問い合わせください。`,
      ),
      {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  // モード①: 確認ページ (デフォルト)
  if (!isDownload) {
    return new Response(
      confirmPage(
        order.orderName,
        order.customerName,
        settings.companyName || "領収書",
        order.totalJpy,
      ),
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, max-age=0, no-store",
        },
      },
    );
  }

  // モード②: PDF ダウンロード
  const finalOrder = customName
    ? { ...order, customerName: customName }
    : order;

  const buffer = await renderToBuffer(
    <ReceiptDocument
      order={finalOrder}
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
      "Content-Disposition": `inline; filename="receipt-${finalOrder.orderName.replace("#", "")}.pdf"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
};
