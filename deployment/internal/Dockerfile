FROM node:24-bookworm-slim
ENV NODE_OPTIONS=--max-old-space-size=128
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8790 BABYSTEPS_DATABASE_PATH=/var/lib/babysteps/internal.sqlite
WORKDIR /opt/babysteps
COPY dist-internal/ ./
RUN mkdir -p /var/lib/babysteps && chown node:node /var/lib/babysteps
USER node
EXPOSE 8790
# Each check starts a Node process (seconds and ~35 MB on a Pi 3), so check rarely
# and give it time; --init in the run command reaps any that outlive the timeout.
HEALTHCHECK --interval=5m --timeout=30s --start-period=30s CMD node -e "fetch('http://127.0.0.1:8790/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "internal-api.mjs"]
