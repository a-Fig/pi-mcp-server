#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageJson {
  readonly version: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson;

process.stdout.write(`pi-mcp-server v${pkg.version}\n`);
process.exit(0);
