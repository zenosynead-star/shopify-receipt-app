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
//   ?k={token}             → 確認ページ (HTML、宛名は注文時確定で readonly)
//   ?k={token}&download=1  → PDF を生成・返却 (再ダウンロード回数 +1)

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

function confirmPage(args: {
  orderName: string;
  recipient: string;
  companyName: string;
  totalJpy: number;
  reissueCount: number;
  issuedAt: Date;
}): string {
  const yen = `¥${args.totalJpy.toLocaleString("ja-JP")}`;
  const alreadyIssued = args.reissueCount >= 1;
  const issuedAtStr = args.issuedAt.toLocaleString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const recipientHasInput = args.recipient && args.recipient !== "ご注文者様";

  // 初回 (未発行): 宛名入力可能 + 発行ボタン
  // 既発行: 宛名 readonly + 発行済みメッセージ + ボタン無効化
  const recipientInput = alreadyIssued
    ? `<input id="name" type="text" value="${escapeHtml(args.recipient)} 様" readonly />`
    : `<input id="name" type="text" name="name" value="${escapeHtml(args.recipient)}" placeholder="ご注文者名" autocomplete="organization" />`;

  const hintText = alreadyIssued
    ? "宛名は初回発行時に確定されています。変更はできません。"
    : "会社名・個人名どちらでも OK。空欄なら「ご注文者様」となります。";

  const button = alreadyIssued
    ? `<button type="button" disabled style="background:#bcbcbc;cursor:not-allowed;">ダウンロード済み</button>`
    : `<button type="submit">📄 PDF をダウンロード（1 回限り）</button>`;

  const alreadyBlock = alreadyIssued
    ? `<div style="background:#fdecea;border-left:4px solid #c41e3a;padding:14px 16px;margin:20px 0;border-radius:4px;font-size:14px;color:#7a1a1a;line-height:1.7;">
    <b>⚠️ 既にダウンロード済みです</b><br>
    この注文の領収書は <b>${issuedAtStr}</b> に発行済みです。<br>
    領収書は 1 注文につき 1 回のみダウンロード可能です（不正発行防止のため）。<br>
    再発行が必要な場合は、お手数ですが <b>ストア管理者にお問い合わせください</b>。
  </div>`
    : `<div style="background:#fff4e5;border-left:4px solid #ff9800;padding:12px 14px;margin:16px 0;border-radius:4px;font-size:13px;color:#7a4a00;line-height:1.6;">
    <b>⚠️ ご注意</b><br>
    領収書は <b>1 注文につき 1 回のみダウンロード可能</b>です。ダウンロード後は変更・再発行できません。<br>
    宛名・金額をご確認の上、ボタンを押してください。
  </div>`;

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
input[type=text][readonly]{background:#f6f6f7;color:#444;}
.hint{font-size:12px;color:#6d7175;margin:6px 0 0;}
button{width:100%;background:#202223;color:white;border:none;padding:14px;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer;margin-top:24px;font-family:inherit;}
button:hover:not(:disabled){background:#000;}
</style></head>
<body>
<div class="box">
  <div class="brand">${escapeHtml(args.companyName)}</div>
  <h1>📄 領収書ダウンロード</h1>
  <p style="margin:0;font-size:14px;color:#6d7175;">下記内容で領収書 (PDF) を発行します。</p>

  <div class="summary">
    <div class="row"><span class="label">注文番号</span><span><b>${escapeHtml(args.orderName)}</b></span></div>
    <div class="row"><span class="label">合計金額</span><span><b>${yen}</b></span></div>
  </div>

  ${alreadyBlock}

  <form method="GET" action="">
    <input type="hidden" name="download" value="1" />
    <label for="name">領収書の宛名${recipientHasInput || alreadyIssued ? "" : "（任意）"}</label>
    ${recipientInput}
    <p class="hint">${hintText}</p>
    ${button}
  </form>
</div>
<script>
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
        `注文 ID <code>${orderId}</code> が確認できませんでした。<br/><br/>考えられる原因:<br/>・注文が <b>過去 60 日</b> より古い (Shopify の仕様で取得不可)<br/>・URL が正しくない / 改ざんされた`,
      ),
      {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  // 発行履歴を取得 (まだ作らない、初回 DL 時に作る)
  const existingIssue = await prisma.receiptIssue.findUnique({
    where: { shop_orderId: { shop, orderId } },
  });

  // モード①: 確認ページ (デフォルト)
  if (!isDownload) {
    // 既発行: DB の recipient を表示
    // 未発行: 注文時のデフォルト宛名 (customAttributes / note / 顧客名)
    const displayRecipient = existingIssue
      ? existingIssue.recipient
      : order.customerName;
    return new Response(
      confirmPage({
        orderName: order.orderName,
        recipient: displayRecipient,
        companyName: settings.companyName || "領収書",
        totalJpy: order.totalJpy,
        reissueCount: existingIssue?.reissueCount ?? 0,
        issuedAt: existingIssue?.issuedAt ?? new Date(),
      }),
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
  // 既発行なら拒否 (1 注文 1 回のみ)
  if (existingIssue) {
    return new Response(
      errorPage(
        "既にダウンロード済みです",
        `この注文の領収書は <b>${existingIssue.issuedAt.toLocaleString("ja-JP")}</b> に発行済みです。<br><br>領収書は 1 注文につき 1 回のみダウンロード可能です。<br>再発行が必要な場合は、ストア管理者にお問い合わせください。`,
      ),
      {
        status: 403,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  // 初回 DL: 宛名を確定 (フォーム入力 → 注文時宛名 の順)
  const customNameFromForm = url.searchParams.get("name")?.trim() || "";
  const finalRecipient = customNameFromForm || order.customerName;

  await prisma.receiptIssue.create({
    data: {
      shop,
      orderId,
      recipient: finalRecipient,
      reissueCount: 1, // 1 = 初回発行済み
    },
  });

  const finalOrder = { ...order, customerName: finalRecipient };
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
      reissueCount={1}
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
