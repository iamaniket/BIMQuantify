# BIMQuantify

> AI-powered BIM quantity takeoff platform supporting IFC and BCF formats

[![Turborepo](https://img.shields.io/badge/turborepo-enabled-blue)](https://turbo.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

BIMQuantify is a monorepo built with [Turborepo](https://turbo.build) that provides an AI-based takeoff tool for Building Information Modeling (BIM). It parses **IFC** (Industry Foundation Classes) files and **BCF** (BIM Collaboration Format) files to automatically generate accurate material and cost takeoffs using AI.

---

## Monorepo Structure

```
BIMQuantify/
├── apps/
│   ├── web/          # Next.js 14 frontend — BIM viewer & takeoff dashboard
│   └── api/          # Fastify API server — IFC/BCF processing & AI takeoff
├── packages/
│   ├── ifc-parser/   # IFC file parsing library (web-ifc)
│   ├── bcf-parser/   # BCF (BIM Collaboration Format) parsing library
│   ├── ai-takeoff/   # AI quantity takeoff engine (OpenAI)
│   ├── ui/           # Shared React UI component library
│   └── tsconfig/     # Shared TypeScript configurations
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (`npm install -g pnpm`)

### Installation

```bash
# Clone the repository
git clone https://github.com/iamaniket/BIMQuantify.git
cd BIMQuantify

# Install all dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Fill in OPENAI_API_KEY and other values
```

### Development

```bash
# Run all apps and packages in watch mode
pnpm dev

# Run only the web app
pnpm --filter=web dev

# Run only the API server
pnpm --filter=api dev
```

### Build

```bash
# Build everything (respects task graph)
pnpm build

# Build a specific package
pnpm --filter=@bim-quantify/ifc-parser build
```

### Testing

```bash
pnpm test
```

---

## Apps

### `apps/web` — Next.js Frontend

The web app provides:
- 📦 IFC file upload & 3D BIM viewer
- 📋 BCF issue viewer and management
- 🤖 AI-driven quantity takeoff dashboard
- 📊 Material / cost estimates export (CSV, Excel)

### `apps/api` — Fastify API Server

The API server exposes REST endpoints for:
- `POST /ifc/parse` — Parse an uploaded IFC file and extract elements
- `POST /bcf/parse` — Parse a BCF zip and return issue list
- `POST /takeoff` — Run AI takeoff on parsed IFC elements
- `GET /health` — Health check

---

## Packages

### `packages/ifc-parser`

Thin wrapper around [`web-ifc`](https://github.com/IFCjs/web-ifc) that:
- Loads IFC files (STEP format)
- Extracts building elements with properties
- Returns typed `IfcElement[]` objects

### `packages/bcf-parser`

Pure-TypeScript BCF 2.1 parser that:
- Reads BCF zip archives
- Extracts topics, comments, viewpoints, and markup
- Returns typed `BcfTopic[]` objects

### `packages/ai-takeoff`

AI-powered quantity takeoff engine that:
- Accepts parsed `IfcElement[]` as input
- Uses OpenAI function calling to classify elements and compute quantities
- Returns `TakeoffItem[]` with material, unit, quantity, and cost estimate

### `packages/ui`

Shared React component library:
- `<IfcViewer>` — Three.js-based IFC 3D viewer
- `<TakeoffTable>` — Sortable/filterable takeoff table
- `<BcfIssueList>` — BCF topic list with viewpoint thumbnails
- `<FileUpload>` — Drag-and-drop file uploader

### `packages/tsconfig`

Shared TypeScript `tsconfig` presets:
- `base.json` — Strict base config
- `nextjs.json` — Next.js config
- `node.json` — Node.js server config

---

## Environment Variables

Create a `.env` file in the root (see `.env.example`):

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key for AI takeoff |
| `DATABASE_URL` | PostgreSQL connection URL (optional) |
| `NEXT_PUBLIC_API_URL` | API base URL consumed by the web app |

---

## License

MIT © iamaniket
