import { useEffect, useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  TextField,
  FormLayout,
  Banner,
  DropZone,
  InlineStack,
  Thumbnail,
  Divider,
  Link,
  Checkbox,
  List,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { shopReceiptSecret } from "../lib/receipt-token";

type LoaderData = {
  shop: string;
  storeHandle: string;
  notificationsUrl: string;
  appUrl: string;
  shopSecret: string;
  settings: {
    companyName: string;
    invoiceNumber: string;
    postalCode: string;
    address: string;
    phone: string;
    email: string;
    stampImageBase64: string | null;
    receiptPrefix: string;
    notes: string;
    emailSnippetApplied: boolean;
  };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const existing = await prisma.shopSettings.findUnique({ where: { shop } });
  const settings = existing ?? {
    companyName: "",
    invoiceNumber: "",
    postalCode: "",
    address: "",
    phone: "",
    email: "",
    stampImageBase64: null,
    receiptPrefix: "R-",
    notes: "商品代として",
    emailSnippetApplied: false,
  };

  const storeHandle = shop.replace(/\.myshopify\.com$/, "");

  return {
    shop,
    storeHandle,
    // 注文確認メールの「コード編集」画面に直接ジャンプ (Shopify Admin の email_templates パス)
    notificationsUrl: `https://admin.shopify.com/store/${storeHandle}/email_templates/order_confirmation/edit`,
    appUrl: process.env.SHOPIFY_APP_URL || "",
    shopSecret: shopReceiptSecret(shop),
    settings: {
      companyName: settings.companyName,
      invoiceNumber: settings.invoiceNumber,
      postalCode: settings.postalCode,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      stampImageBase64: settings.stampImageBase64,
      receiptPrefix: settings.receiptPrefix,
      notes: settings.notes,
      emailSnippetApplied: settings.emailSnippetApplied ?? false,
    },
  } satisfies LoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();
  const get = (k: string) => (form.get(k) as string | null) ?? "";
  const stampImageBase64 = (form.get("stampImageBase64") as string) || null;
  const emailSnippetApplied = form.get("emailSnippetApplied") === "true";

  await prisma.shopSettings.upsert({
    where: { shop },
    create: {
      shop,
      companyName: get("companyName"),
      invoiceNumber: get("invoiceNumber"),
      postalCode: get("postalCode"),
      address: get("address"),
      phone: get("phone"),
      email: get("email"),
      receiptPrefix: get("receiptPrefix") || "R-",
      notes: get("notes"),
      stampImageBase64,
      emailSnippetApplied,
    },
    update: {
      companyName: get("companyName"),
      invoiceNumber: get("invoiceNumber"),
      postalCode: get("postalCode"),
      address: get("address"),
      phone: get("phone"),
      email: get("email"),
      receiptPrefix: get("receiptPrefix") || "R-",
      notes: get("notes"),
      stampImageBase64,
      emailSnippetApplied,
    },
  });

  return { ok: true };
};

const buildSnippet = (appUrl: string, shop: string, secret: string) => `{% comment %} 領収書ダウンロードリンク (shopify-receipt-app) {% endcomment %}
<div style="margin:32px 0;padding:16px;text-align:center;background:#f6f6f7;border-radius:6px;">
  <p style="margin:0 0 12px;font-size:14px;color:#202223;">
    領収書（適格請求書）をダウンロードいただけます
  </p>
  <a href="${appUrl}/r/${shop}/{{ order.id }}?k=${secret}"
     style="display:inline-block;background:#202223;color:#ffffff;padding:12px 28px;
            text-decoration:none;border-radius:4px;font-weight:600;font-size:14px;">
    領収書をダウンロード（PDF）
  </a>
</div>`;

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const appBridge = useAppBridge();

  const [form, setForm] = useState(data.settings);
  const [stampImageBase64, setStamp] = useState<string | null>(
    data.settings.stampImageBase64,
  );
  const [snippetApplied, setSnippetApplied] = useState<boolean>(
    data.settings.emailSnippetApplied,
  );
  const [previewVersion, setPreviewVersion] = useState(0);

  const isSaving =
    fetcher.state === "submitting" || fetcher.state === "loading";

  useEffect(() => {
    if (fetcher.data?.ok) {
      appBridge.toast.show("保存しました");
      setPreviewVersion((v) => v + 1); // 保存後にプレビュー iframe を再ロード
    }
  }, [fetcher.data, appBridge]);

  const handleDrop = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setStamp(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleSave = () => {
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => {
      if (typeof v === "boolean") return; // boolean は個別 set で扱う
      fd.set(k, (v as string | null) ?? "");
    });
    fd.set("stampImageBase64", stampImageBase64 ?? "");
    fd.set("emailSnippetApplied", snippetApplied ? "true" : "false");
    fetcher.submit(fd, { method: "POST" });
  };

  const snippet = buildSnippet(data.appUrl, data.shop, data.shopSecret);

  return (
    <Page>
      <TitleBar title="領収書設定" />
      <BlockStack gap="500">
        {!snippetApplied ? (
          <Banner
            tone="warning"
            title="初期セットアップ: メール本文への貼り付けが未完了です"
          >
            <Text as="p" variant="bodyMd">
              注文確認メールに領収書 DL リンクを表示するため、画面右側の Liquid スニペットを Shopify 管理画面の <b>設定 → 通知 → 注文確認</b> の HTML 本文に 1 度だけ貼り付ける必要があります。手順は右側カードに記載しています。
            </Text>
          </Banner>
        ) : null}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  発行者情報（領収書に表示されます）
                </Text>
                <FormLayout>
                  <TextField
                    label="会社名 / 屋号"
                    value={form.companyName}
                    onChange={(v) => setForm({ ...form, companyName: v })}
                    autoComplete="organization"
                    requiredIndicator
                  />
                  <TextField
                    label="適格請求書発行事業者登録番号（T + 13桁）"
                    value={form.invoiceNumber}
                    onChange={(v) => setForm({ ...form, invoiceNumber: v })}
                    placeholder="T1234567890123"
                    autoComplete="off"
                    helpText="国税庁の登録番号。空欄なら表示されません"
                  />
                  <FormLayout.Group>
                    <TextField
                      label="郵便番号"
                      value={form.postalCode}
                      onChange={(v) => setForm({ ...form, postalCode: v })}
                      placeholder="100-0001"
                      autoComplete="postal-code"
                    />
                    <TextField
                      label="電話番号"
                      value={form.phone}
                      onChange={(v) => setForm({ ...form, phone: v })}
                      placeholder="03-1234-5678"
                      autoComplete="tel"
                    />
                  </FormLayout.Group>
                  <TextField
                    label="住所"
                    value={form.address}
                    onChange={(v) => setForm({ ...form, address: v })}
                    autoComplete="street-address"
                  />
                  <TextField
                    label="メールアドレス"
                    value={form.email}
                    onChange={(v) => setForm({ ...form, email: v })}
                    autoComplete="email"
                    type="email"
                  />
                </FormLayout>
              </BlockStack>
            </Card>

            <div style={{ height: 16 }} />

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  電子印影
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  社印 / 屋号印の画像（PNG または JPEG、推奨 300×300px、背景透過 PNG が綺麗です）
                </Text>
                <InlineStack gap="400" align="start" blockAlign="center">
                  <div style={{ width: 200 }}>
                    <DropZone
                      accept="image/png,image/jpeg"
                      type="image"
                      allowMultiple={false}
                      onDrop={handleDrop}
                    >
                      <DropZone.FileUpload actionTitle="ファイルを選択" />
                    </DropZone>
                  </div>
                  {stampImageBase64 ? (
                    <BlockStack gap="200">
                      <Thumbnail
                        source={stampImageBase64}
                        alt="印影プレビュー"
                        size="large"
                      />
                      <Button
                        variant="plain"
                        tone="critical"
                        onClick={() => setStamp(null)}
                      >
                        削除
                      </Button>
                    </BlockStack>
                  ) : null}
                </InlineStack>
              </BlockStack>
            </Card>

            <div style={{ height: 16 }} />

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  領収書フォーマット
                </Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="領収書番号 接頭辞"
                      value={form.receiptPrefix}
                      onChange={(v) => setForm({ ...form, receiptPrefix: v })}
                      placeholder="R-"
                      autoComplete="off"
                      helpText="例: R- にすると R-1001 のような番号になります"
                    />
                    <TextField
                      label="但し書きデフォルト"
                      value={form.notes}
                      onChange={(v) => setForm({ ...form, notes: v })}
                      placeholder="商品代として"
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                </FormLayout>
              </BlockStack>
            </Card>

            <div style={{ height: 16 }} />

            <InlineStack align="end">
              <Button
                variant="primary"
                onClick={handleSave}
                loading={isSaving}
              >
                保存
              </Button>
            </InlineStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    領収書プレビュー（PDF）
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    サンプル注文 + 現在の設定で生成。保存すると最新内容に更新。
                  </Text>
                  <iframe
                    src={`${data.appUrl}/preview/${data.shop}?k=${data.shopSecret}&_t=${previewVersion}`}
                    style={{
                      width: "100%",
                      height: 500,
                      border: "1px solid #e1e3e5",
                      borderRadius: 4,
                    }}
                    title="領収書プレビュー"
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    送信メールプレビュー
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    注文確認メールがお客様にどう見えるか確認できます。中央のボタンが領収書 DL リンク。
                  </Text>
                  <iframe
                    src={`${data.appUrl}/preview-email/${data.shop}?k=${data.shopSecret}&_t=${previewVersion}`}
                    style={{
                      width: "100%",
                      height: 600,
                      border: "1px solid #e1e3e5",
                      borderRadius: 4,
                    }}
                    title="注文確認メール プレビュー"
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    メールへの組み込み（初回 1 度だけ）
                  </Text>
                  {!data.appUrl ? (
                    <Banner tone="warning">
                      アプリ URL がまだ取得できていません。Render の SHOPIFY_APP_URL 環境変数が設定されているか確認してください。
                    </Banner>
                  ) : null}

                  <Banner tone="info">
                    <p>
                      ⚠️ Shopify の仕様上、貼り付けは完全自動化できません。<b>下のボタン</b>でコピー＋編集画面が同時に開きます。あとは新タブで <b>Ctrl+End → Enter → Ctrl+V → 保存</b> の 4 キー操作のみ。
                    </p>
                  </Banner>

                  <Button
                    variant="primary"
                    size="large"
                    onClick={() => {
                      navigator.clipboard.writeText(snippet);
                      appBridge.toast.show("コピー完了！編集画面を開きます");
                      window.open(data.notificationsUrl, "_blank");
                    }}
                  >
                    📋 コピー + 編集画面を開く（1 クリック）
                  </Button>

                  <Text as="p" variant="bodyMd">編集画面でのキー操作:</Text>
                  <List type="number">
                    <List.Item><code>Ctrl + End</code>（Mac は <code>⌘ + ↓</code>）— エディタ最下部にカーソル移動</List.Item>
                    <List.Item><code>Enter</code> — 改行</List.Item>
                    <List.Item><code>Ctrl + V</code>（Mac は <code>⌘ + V</code>）— 貼り付け</List.Item>
                    <List.Item>右上の <b>「保存」</b> ボタンをクリック</List.Item>
                    <List.Item>このページに戻って <b>「貼り付け完了」</b> にチェック → <b>「保存」</b></List.Item>
                  </List>

                  <Divider />

                  <Text as="p" variant="bodySm" tone="subdued">
                    手動でコピーしたい場合は下のテキスト欄から:
                  </Text>
                  <TextField
                    label="Liquid スニペット（手動コピー用）"
                    value={snippet}
                    multiline={5}
                    autoComplete="off"
                    onChange={() => {}}
                    readOnly
                    monospaced
                    selectTextOnFocus
                  />

                  <Divider />

                  <Checkbox
                    label="貼り付け完了"
                    checked={snippetApplied}
                    onChange={(v) => setSnippetApplied(v)}
                    helpText="チェックを入れて「保存」ボタンを押すと、上部の警告が消えます"
                  />

                  <Text as="p" variant="bodySm" tone="subdued">
                    URL は注文ごとに <code>{`{{ order.id }}`}</code> で動的に置換されます。
                    トークン <code>k</code> はショップ固有の固定値です。
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    プレビュー
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    任意の注文 ID を入れてプレビュー表示できます（保存後に有効）
                  </Text>
                  <PreviewLink
                    appUrl={data.appUrl}
                    shop={data.shop}
                    secret={data.shopSecret}
                  />
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

function PreviewLink(props: {
  appUrl: string;
  shop: string;
  secret: string;
}) {
  const [orderId, setOrderId] = useState("");
  const trimmed = orderId.trim();
  const url = trimmed
    ? `${props.appUrl}/r/${props.shop}/${encodeURIComponent(trimmed)}?k=${props.secret}`
    : "";
  return (
    <BlockStack gap="200">
      <TextField
        label="注文 ID または注文名"
        value={orderId}
        onChange={setOrderId}
        autoComplete="off"
        placeholder="5460681064696 または #7643"
        helpText="数字のみ = 注文ID、# 付きや英字含み = 注文名として検索。過去 60 日以内の注文のみ取得可能 (Shopify 仕様)"
      />
      {url ? (
        <Link url={url} target="_blank">
          プレビューを開く
        </Link>
      ) : null}
    </BlockStack>
  );
}
