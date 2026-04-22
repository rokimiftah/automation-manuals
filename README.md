# Astro + Convex Boilerplate

A minimal starter template for building full-stack applications with Astro, Convex, React, and Feature-Sliced Design (FSD) architecture.

[![Astro](https://img.shields.io/badge/Astro-6.x-FF5D01?logo=astro)](https://astro.build)
[![Convex](https://img.shields.io/badge/Convex-1.x-8B5CF6?logo=convex)](https://convex.dev)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.x-06B6D4?logo=tailwindcss)](https://tailwindcss.com)

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [Deployment](#deployment)

---

## Overview

This boilerplate provides a solid foundation for building scalable web applications with:

- **Static Site Generation (SSG)** with Astro for optimal performance
- **Real-time backend** with Convex for reactive data synchronization
- **React islands** for interactive client-side components
- **Type-safe development** with TypeScript
- **Scalable architecture** using Feature-Sliced Design methodology

---

## Tech Stack

### Core Framework

- **[Astro](https://astro.build/)** v6.x - Static site generator with islands architecture
- **[Convex](https://convex.dev/)** v1.x - Real-time backend-as-a-service
- **[React](https://react.dev/)** v19 - UI library for interactive components

### Styling & UI

- **[Tailwind CSS](https://tailwindcss.com/)** v4.x - Utility-first CSS framework

### Development Tools

- **[TypeScript](https://typescriptlang.org/)** v5.x - Type-safe JavaScript
- **[Biome](https://biomejs.dev/)** v2.x - Fast linter and formatter
- **[Prettier](https://prettier.io/)** v3.x - Code formatting
- **[Bun](https://bun.sh/)** - Fast JavaScript runtime and package manager

### Architecture

- **[Feature-Sliced Design (FSD)](https://feature-sliced.design/)** - Scalable frontend architecture methodology

---

## Features

- **Full FSD Architecture** - 6 layers (app, pages, widgets, features, entities, shared)
- **Islands Architecture** - Zero JavaScript by default, hydrated islands where needed
- **Real-time Sync** - Live data synchronization with Convex
- **Tailwind CSS v4** - Latest version with improved performance
- **Path Aliases** - Clean imports with `@app`, `@features`, `@entities`, `@shared`
- **Import Sorting** - Automatic import organization with Prettier
- **Linting** - Fast linting with Biome
- **Type Safety** - Full TypeScript coverage

---

## Architecture

This project follows **[Feature-Sliced Design (FSD)](https://feature-sliced.design/)**, an architectural methodology for organizing frontend code.

### Layer Hierarchy (Top to Bottom)

```
┌─────────────┐
│     App     │  Entry points, providers, global styles
├─────────────┤
│    Pages    │  Full pages (Astro pages)
├─────────────┤
│   Widgets   │  Large composite UI blocks
├─────────────┤
│   Features  │  Product features with business value
├─────────────┤
│   Entities  │  Business entities (user, post, comment)
├─────────────┤
│   Shared    │  Reusable infrastructure
└─────────────┘
```

### Dependency Rule

A module on one layer can only import from layers **strictly below** it:

- **App** → Pages, Widgets, Features, Entities, Shared
- **Pages** → Widgets, Features, Entities, Shared
- **Widgets** → Features, Entities, Shared
- **Features** → Entities, Shared
- **Entities** → Shared
- **Shared** → (no lower layers)

### Import Order

Prettier automatically sorts imports following FSD hierarchy:

1. Types (`<TYPES>`)
2. Built-in modules (`<BUILTIN_MODULES>`)
3. React (`^react`)
4. Astro (`^astro`)
5. Convex SDK (`^convex`)
6. Convex Generated (`^@convex/_generated`)
7. Third-party libraries (`<THIRD_PARTY_MODULES>`)
8. **FSD Layers** (in order):
   - `@app/*`
   - `@pages/*`
   - `@widgets/*`
   - `@features/*`
   - `@entities/*`
   - `@shared/*`
9. Local modules (`^[./]`)
10. CSS files

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18.x or higher
- [Bun](https://bun.sh/) 1.x (recommended)
- [Git](https://git-scm.com/)

### Installation

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/astro-convex-boilerplate.git
cd astro-convex-boilerplate
```

2. **Install dependencies**

```bash
bun install
```

3. **Set up Convex**

```bash
# Login to Convex
bunx convex login

# Initialize Convex project
bunx convex dev
```

4. **Configure environment variables**

```bash
# Copy example file
cp .env.local.example .env.local

# Fill in your Convex credentials from https://dashboard.convex.dev
```

5. **Start development server**

```bash
# Start both Astro and Convex dev servers
bun run dev
```

Your site will be available at `http://localhost:3000`

---

## Project Structure

```
.
├── convex/                    # Convex backend functions
│   ├── _generated/            # Auto-generated Convex code
│   ├── comments.ts          # Example: comments feature
│   └── schema.ts            # Database schema
├── src/
│   ├── app/                   # App layer
│   │   ├── providers/         # React context providers
│   │   │   └── ConvexProvider.tsx
│   │   └── styles/            # Global styles
│   │       └── global.css
│   ├── pages/                 # Pages layer
│   │   └── index.astro
│   ├── widgets/               # Widgets layer
│   │   └── README.md
│   ├── features/              # Features layer
│   │   └── comments/
│   │       ├── api/           # API hooks
│   │       ├── model/         # Types & business logic
│   │       ├── ui/            # UI components
│   │       │   ├── CommentForm.tsx
│   │       │   ├── CommentList.tsx
│   │       │   └── index.ts
│   │       ├── island.tsx     # Astro island wrapper
│   │       └── index.ts       # Public API
│   ├── entities/              # Entities layer
│   │   └── comment/
│   │       ├── model/         # Entity types
│   │       │   └── types.ts
│   │       └── index.ts
│   ├── shared/                # Shared layer
│   │   ├── api/               # Shared API clients
│   │   ├── ui/                # UI kit
│   │   └── lib/               # Utilities
│   ├── layouts/               # Astro layouts
│   │   └── Layout.astro
│   └── assets/                # Static assets
├── .env.local.example         # Environment variables template
├── astro.config.mjs           # Astro configuration
├── biome.json                 # Biome linter config
├── convex.json                # Convex configuration
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript config
└── .prettierrc                # Prettier config
```

---

## Development Workflow

### Creating a New Feature

1. **Create feature structure**

```bash
mkdir -p src/features/my-feature/{api,model,ui}
touch src/features/my-feature/index.ts
```

2. **Implement the feature**

```typescript
// src/features/my-feature/ui/MyComponent.tsx
import { useQuery } from "convex/react"
import { api } from "@convex/_generated/api"

export function MyComponent() {
  const data = useQuery(api.myFeature.list)
  return <div>{/* ... */}</div>
}
```

3. **Export from feature's public API**

```typescript
// src/features/my-feature/index.ts
export { MyComponent } from "./ui/MyComponent"
```

4. **Use in pages**

```astro
---
import { MyComponent } from "@features/my-feature"
---

<MyComponent client:load />
```

### Code Quality

```bash
# Format code
bun run format

# Lint code
bun run lint
```

### Convex Development

```bash
# Start Convex dev server
bun run convex:dev

# Deploy to production
bun run convex:deploy
```

---

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in your values:

| Variable            | Description                                 | Source           |
| ------------------- | ------------------------------------------- | ---------------- |
| `CONVEX_DEPLOYMENT` | Deployment identifier from Convex dashboard | Convex Dashboard |
| `CONVEX_URL`        | Convex production URL                       | Convex Dashboard |
| `CONVEX_SITE_URL`   | Convex site URL for production              | Convex Dashboard |

**Note:** Never commit `.env.local` to version control. It's already in `.gitignore`.

---

## Scripts

| Script          | Command                                          | Description                 |
| --------------- | ------------------------------------------------ | --------------------------- |
| `dev`           | `astro dev`                                      | Start Astro dev server      |
| `build`         | `astro build`                                    | Build for production        |
| `preview`       | `astro preview`                                  | Preview production build    |
| `convex:dev`    | `convex dev`                                     | Start Convex dev server     |
| `convex:deploy` | `convex deploy`                                  | Deploy Convex to production |
| `format`        | `prettier --write .`                             | Format all files            |
| `lint`          | `biome check --write --unsafe . && tsc --noEmit` | Lint and type check         |

---

## Deployment

### Convex Backend

```bash
bun run convex:deploy
```

### Astro Site

#### Static Deployment (Recommended)

Configure `astro.config.mjs`:

```javascript
export default defineConfig({
  output: "static",
  adapter: undefined // or use @astrojs/node for SSR
})
```

Build and deploy:

```bash
bun run build
```

Deploy the `dist/` folder to your hosting provider (Vercel, Netlify, Cloudflare Pages, etc.)

#### SSR Deployment

For server-side rendering, install an adapter:

```bash
# Vercel
bun add @astrojs/vercel

# Netlify
bun add @astrojs/netlify

# Node.js
bun add @astrojs/node
```

Then update `astro.config.mjs` accordingly.

---

## Resources

- [Astro Documentation](https://docs.astro.build)
- [Convex Documentation](https://docs.convex.dev)
- [Feature-Sliced Design](https://feature-sliced.design/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [React Documentation](https://react.dev)

---

## License

MIT License - feel free to use this boilerplate for any project.

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## Support

- [Convex Discord](https://convex.dev/community)
- [Astro Discord](https://astro.build/chat)
- [Feature-Sliced Design Telegram](https://t.me/feature_sliced)
