// Metro config for the pnpm/turbo monorepo.
// Expo SDK 56 / Metro resolve symlinks + package exports by default. For pnpm we
// (1) watch the workspace root so changes in shared packages are picked up, and
// (2) add the root node_modules as a fallback resolution path.
// NOTE: do NOT set `disableHierarchicalLookup` here — pnpm nests each package's
// deps under .pnpm/<pkg>/node_modules, and Metro must walk that symlink chain to
// resolve transitive deps like @expo/metro-runtime. Disabling hierarchical
// lookup confines Metro to nodeModulesPaths only and breaks pnpm resolution.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
