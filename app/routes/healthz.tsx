// UptimeRobot などからの ping 用。DB に触らず即応答する軽量エンドポイント。
// /healthz でアクセス可能。Render Free のスリープ回避に使う。
export const loader = () => {
  return new Response("ok", {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
    },
  });
};
