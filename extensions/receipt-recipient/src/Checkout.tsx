import {
  reactExtension,
  BlockStack,
  TextField,
  Text,
  useAttributeValues,
  useApplyAttributeChange,
} from "@shopify/ui-extensions-react/checkout";

export default reactExtension("purchase.checkout.block.render", () => <App />);

const ATTR_KEY = "receipt_recipient";

function App() {
  // 既存の attribute 値を取得 (リロード時の保持)
  const [current] = useAttributeValues([ATTR_KEY]);
  const applyAttributeChange = useApplyAttributeChange();

  return (
    <BlockStack spacing="base">
      <TextField
        label="領収書の宛名（任意）"
        value={current ?? ""}
        onChange={async (value: string) => {
          await applyAttributeChange({
            type: "updateAttribute",
            key: ATTR_KEY,
            value,
          });
        }}
      />
      <Text size="small" appearance="subdued">
        記入された場合、注文確認メールに添付される領収書 PDF の宛名に反映されます。空欄なら「ご注文者様」のお名前が使われます。
      </Text>
    </BlockStack>
  );
}
