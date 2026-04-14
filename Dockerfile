FROM mcr.microsoft.com/playwright:v1.58.2

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production 2>/dev/null || npm install --production --ignore-scripts

COPY src/ ./src/

ENTRYPOINT ["node", "src/push-certs.js"]
