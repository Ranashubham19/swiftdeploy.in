FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ca-certificates util-linux tini \
  && rm -rf /var/lib/apt/lists/*

# Sandbox user/group for child code execution. The service process remains root so it can
# drop privileges per job using spawn({ uid, gid }).
RUN groupadd -g 10001 sandbox \
  && useradd -u 10001 -g 10001 -m -s /usr/sbin/nologin sandbox \
  && mkdir -p /var/log/runner \
  && chown -R root:root /app /var/log/runner

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.mjs ./

ENV PORT=8081
EXPOSE 8081

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
