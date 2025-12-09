FROM node:20-alpine

WORKDIR /app

# 依存関係のインストール
COPY package*.json ./
RUN npm ci

# ソースコードのコピー
COPY . .

# TypeScriptのビルド（本番環境用）
# RUN npm run build

# 開発時はtsx watchを使用
CMD ["npm", "run", "dev"]
