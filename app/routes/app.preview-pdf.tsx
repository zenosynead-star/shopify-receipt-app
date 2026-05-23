import type { LoaderFunctionArgs } from "@remix-run/node";
import { renderToBuffer } from "@react-pdf/renderer";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ReceiptDocument } from "../lib/receipt-pdf";
import type { ReceiptOrder } from "../lib/order-fetcher";

// 設定画面の iframe 用: ハードコードのサンプル注文 + 現在の DB 設定で PDF 生成。
// 認証必須 (Shopify Admin 内からのみ閲覧可)。
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const existing = await prisma.shopSettings.findUnique({ where: { shop } });

  const issuer = {
    companyName:
      existing?.companyName || "(会社名 未設定 — 保存するとここに反映)",
    invoiceNumber: existing?.invoiceNumber || "",
    postalCode: existing?.postalCode || "",
    address: existing?.address || "",
    phone: existing?.phone || "",
    email: existing?.email || "",
    stampImageBase64: existing?.stampImageBase64 || null,
    receiptPrefix: existing?.receiptPrefix || "R-",
    notes: existing?.notes || "商品代として",
  };

  // サンプル注文: 複数税率 (10% / 8%) と複数行アイテムを含む
  const sampleOrder: ReceiptOrder = {
    orderName: "#9999",
    orderId: "9999",
    processedAt: new Date().toISOString(),
    customerName: "山田 太郎",
    subtotalJpy: 18000,
    taxByRate: {
      10: { net: 10000, tax: 1000 },
      8: { net: 8000, tax: 640 },
    },
    totalJpy: 19640,
    lineItems: [
      {
        title: "サンプル商品 A (標準税率)",
        quantity: 2,
        unitPriceJpy: 5000,
        totalJpy: 10000,
        taxRate: 10,
      },
      {
        title: "サンプル食品 B (軽減税率)",
        quantity: 4,
        unitPriceJpy: 2000,
        totalJpy: 8000,
        taxRate: 8,
      },
    ],
  };

  const buffer = await renderToBuffer(
    <ReceiptDocument order={sampleOrder} issuer={issuer} />,
  );

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="receipt-preview.pdf"',
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
};
