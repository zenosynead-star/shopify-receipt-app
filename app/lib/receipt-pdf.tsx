import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Image,
} from "@react-pdf/renderer";
import path from "node:path";
import type { ReceiptOrder } from "./order-fetcher";

// Noto Sans JP を登録（サーバーサイドのみ実行）
let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  const fontsDir = path.resolve("./public/fonts");
  Font.register({
    family: "NotoSansJP",
    fonts: [
      { src: path.join(fontsDir, "NotoSansJP-Regular.ttf") },
      { src: path.join(fontsDir, "NotoSansJP-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // 改行禁則 (日本語の禁則処理)
  Font.registerHyphenationCallback((word) => Array.from(word));
  fontsRegistered = true;
}

const s = StyleSheet.create({
  page: {
    fontFamily: "NotoSansJP",
    fontSize: 10,
    padding: 40,
    color: "#111",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  title: { fontSize: 24, fontWeight: "bold", letterSpacing: 8 },
  metaBox: { textAlign: "right", fontSize: 9, lineHeight: 1.6 },
  recipientBlock: { marginBottom: 16 },
  recipient: { fontSize: 14, borderBottom: "1pt solid #111", paddingBottom: 4, paddingTop: 8 },
  amountBlock: {
    backgroundColor: "#f4f4f4",
    padding: 12,
    marginVertical: 16,
    alignItems: "center",
  },
  amountLabel: { fontSize: 9, marginBottom: 4 },
  amount: { fontSize: 24, fontWeight: "bold" },
  noteRow: { flexDirection: "row", marginBottom: 16 },
  noteLabel: { width: 60, fontSize: 10 },
  noteValue: { flex: 1, fontSize: 10, borderBottom: "0.5pt solid #999", paddingBottom: 2 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#e8e8e8",
    paddingVertical: 6,
    paddingHorizontal: 4,
    fontWeight: "bold",
    fontSize: 9,
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "0.5pt solid #ddd",
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontSize: 9,
  },
  colTitle: { flex: 4 },
  colQty: { flex: 1, textAlign: "right" },
  colUnit: { flex: 1.5, textAlign: "right" },
  colTotal: { flex: 1.5, textAlign: "right" },
  colRate: { flex: 1, textAlign: "right" },
  taxSummary: { marginTop: 12, alignSelf: "flex-end", fontSize: 9, lineHeight: 1.6 },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: 24,
    paddingTop: 12,
    borderTop: "0.5pt solid #999",
  },
  issuerBlock: { fontSize: 9, lineHeight: 1.6, flex: 1 },
  issuerName: { fontSize: 12, fontWeight: "bold", marginBottom: 4 },
  stamp: { width: 60, height: 60 },
});

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

const formatJpDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

export type ReceiptIssuer = {
  companyName: string;
  invoiceNumber: string;
  postalCode: string;
  address: string;
  phone: string;
  email: string;
  stampImageBase64?: string | null;
  receiptPrefix: string;
  notes: string;
};

export function ReceiptDocument(props: {
  order: ReceiptOrder;
  issuer: ReceiptIssuer;
  reissueCount?: number; // 1=初回発行, 2以上=再発行
}) {
  registerFonts();
  const { order, issuer } = props;
  const reissueCount = props.reissueCount ?? 1;
  const isReissue = reissueCount >= 2;
  const receiptNo = `${issuer.receiptPrefix}${order.orderName.replace("#", "")}${isReissue ? `-R${reissueCount}` : ""}`;
  const noteText = issuer.notes || "商品代として";

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          <Text style={s.title}>領 収 書</Text>
          <View style={s.metaBox}>
            <Text>No. {receiptNo}</Text>
            <Text>発行日: {formatJpDate(order.processedAt)}</Text>
            <Text>注文番号: {order.orderName}</Text>
            {isReissue ? (
              <Text style={{ color: "#c41e3a", fontWeight: "bold", marginTop: 4 }}>
                ⚠ 再発行 (R{reissueCount})
              </Text>
            ) : null}
          </View>
        </View>

        <View style={s.recipientBlock}>
          <Text style={s.recipient}>{order.customerName} 様</Text>
        </View>

        <View style={s.amountBlock}>
          <Text style={s.amountLabel}>金額（税込）</Text>
          <Text style={s.amount}>{yen(order.totalJpy)}</Text>
        </View>

        <View style={s.noteRow}>
          <Text style={s.noteLabel}>但し</Text>
          <Text style={s.noteValue}>{noteText}（上記正に領収いたしました）</Text>
        </View>

        <View style={s.tableHeader}>
          <Text style={s.colTitle}>品目</Text>
          <Text style={s.colQty}>数量</Text>
          <Text style={s.colUnit}>単価</Text>
          <Text style={s.colTotal}>金額</Text>
          <Text style={s.colRate}>税率</Text>
        </View>
        {order.lineItems.map((item, i) => (
          <View key={i} style={s.tableRow}>
            <Text style={s.colTitle}>{item.title}</Text>
            <Text style={s.colQty}>{item.quantity}</Text>
            <Text style={s.colUnit}>{yen(item.unitPriceJpy)}</Text>
            <Text style={s.colTotal}>{yen(item.totalJpy)}</Text>
            <Text style={s.colRate}>{item.taxRate}%</Text>
          </View>
        ))}

        <View style={s.taxSummary}>
          {Object.entries(order.taxByRate).map(([rate, v]) => (
            <Text key={rate}>
              {rate}%対象: {yen(v.net)}　（内消費税 {yen(v.tax)}）
            </Text>
          ))}
          <Text style={{ fontWeight: "bold", marginTop: 4 }}>
            合計: {yen(order.totalJpy)}
          </Text>
        </View>

        <View style={s.footerRow}>
          <View style={s.issuerBlock}>
            <Text style={s.issuerName}>{issuer.companyName || "（発行者名 未設定）"}</Text>
            {issuer.postalCode ? <Text>〒{issuer.postalCode}</Text> : null}
            {issuer.address ? <Text>{issuer.address}</Text> : null}
            {issuer.phone ? <Text>TEL: {issuer.phone}</Text> : null}
            {issuer.email ? <Text>{issuer.email}</Text> : null}
            {issuer.invoiceNumber ? (
              <Text style={{ marginTop: 4, fontWeight: "bold" }}>
                登録番号: {issuer.invoiceNumber}
              </Text>
            ) : null}
          </View>
          {issuer.stampImageBase64 ? (
            <Image src={issuer.stampImageBase64} style={s.stamp} />
          ) : null}
        </View>
      </Page>
    </Document>
  );
}
