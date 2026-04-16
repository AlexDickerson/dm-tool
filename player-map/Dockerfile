# Multi-stage build: install + build in node, serve from nginx.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
# Copy the Vite build output into the default nginx serve dir.
COPY --from=build /app/dist /usr/share/nginx/html
# SPA fallback — serve index.html for any route that doesn't match a file.
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / {\n    try_files $uri /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
