FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY index.html connexion.html styles.css manifest.webmanifest icon.svg icon-180.png server.mjs ./
COPY js ./js
COPY server ./server
RUN mkdir -p /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=5173 DATA_DIR=/data CLAUDE_MODE=api TRUST_PROXY=1
VOLUME /data
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/sante').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.mjs"]
