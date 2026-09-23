import pino from 'pino';
import { config } from './config.js';

/** Structured JSON logger shared by the API, jobs and keeper. */
export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  base: { service: 'bucket-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
