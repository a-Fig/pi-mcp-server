import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageJson {
  readonly name: string;
  readonly version: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson;

export const PACKAGE_NAME = 'pi-mcp-server';
export const PACKAGE_VERSION: string = pkg.version;
