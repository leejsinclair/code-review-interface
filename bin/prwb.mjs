#!/usr/bin/env node
// npx entry: starts the workbench from the published build.
import { startWorkbench } from '../dist/main.js';

await startWorkbench();
