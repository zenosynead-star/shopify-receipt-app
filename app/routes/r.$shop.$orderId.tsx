import type { LoaderFunctionArgs } from "@remix-run/node";
import { renderToBuffer } from "@react-pdf/renderer";
import prisma from "../db.server";
import { fetchReceiptOrder } from "../lib/order-fetcher";
import { ReceiptDocument } from "../lib/receipt-pdf";
import { verifyShopReceiptToken } from "../lib/receipt-token";

// メールに埋め込まれるリンク: /r/{shop}/{orderId}?t={token}
// 顧客が直接アクセスする想定のため認証なし。トークンで照合。
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
    return new Response("Shop settings not configured", { status: 404 });
  }

  const order = await fetchReceiptOrder(shop, orderId);
  if (!order) {
    return new Response("Order not found", { status: 404 });
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
