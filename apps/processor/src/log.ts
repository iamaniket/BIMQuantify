import pino, { type LoggerOptions } from 'pino';

import { getConfig } from './config.js';

const config = getConfig();

const baseOptions: LoggerOptions = {
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
};

const options: LoggerOptions =
  config.NODE_ENV === 'production'
    ? baseOptions
    : {
        ...baseOptions,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
      };

export const logger = pino(options);

export type Logger = typeof logger;
