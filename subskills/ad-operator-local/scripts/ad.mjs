#!/usr/bin/env node
import {runPlatformEntry} from '../../../scripts/platform-entry.mjs';
process.exitCode=await runPlatformEntry('local');
