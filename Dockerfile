FROM node:20-alpine

# Prisma の Linux ビルドに必要 + フォント関連のためにビルドツールも入れておく
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

# 依存だけ先にコピーしてキャッシュ効かせる
COPY package.json package-lock.json* ./
# Shopify テンプレに React 19 を peer dep で要求するパッケージがあるため、
# lock file 不整合を許容する --legacy-peer-deps を付けて install。
RUN npm install --omit=dev --legacy-peer-deps && npm cache clean --force

# 本番不要な Shopify CLI を削除（イメージ縮小）
RUN npm remove @shopify/cli @shopify/plugin-cloudflare 2>/dev/null || true

# アプリ本体（public/fonts/NotoSansJP-*.ttf も含む）
COPY . .

# Prisma generate と Remix ビルド
RUN npx prisma generate
RUN npm run build

EXPOSE 3000

# 起動時に migrate deploy + Remix サーバー
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
