FROM node:24-alpine

WORKDIR /app

# 依存関係のインストール
COPY package*.json ./
RUN apk add --no-cache python3 make g++
RUN npm ci

# ソースコードのコピー
COPY . .

# 開発サーバー起動
EXPOSE 3000
CMD ["npm", "run", "dev"]