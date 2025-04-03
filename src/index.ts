#!/usr/bin/env node

import { startServer } from './server/server';

startServer().catch((error: unknown) => {
  console.error("Fatal error in main():", error instanceof Error ? error.message : String(error));
  process.exit(1);
}); 