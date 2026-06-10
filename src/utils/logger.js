// src/utils/logger.js
// Logger centralizado usando pino — formato legível em dev, JSON em produção

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino(
  {
    level: isDev ? 'debug' : 'info',
    // Em produção, o JSON puro é ideal para ingestão em ferramentas como Datadog/Loki
    ...(isDev && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    }),
  }
);

export default logger;
