# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Platform is a Node.js/Express REST API backend serving a family communication and activity management system. It features real-time device synchronization via Firebase Cloud Messaging (FCM), a PostgreSQL database managed with Prisma ORM, and support for AAC (Augmentative and Alternative Communication) messaging, library/media management, and child home customization.

**Key Users/Roles:**
- PARENT: Can manage family, invite members, manage library, create/update child home
- CHILD: Can send messages, receive invites, use child home interface

## Tech Stack

- **Runtime**: Node.js 20 (Alpine in production)
- **Framework**: Express 5.2.1
- **Language**: TypeScript 5.9 (strict mode)
- **Database**: PostgreSQL 16 with Prisma 7.3.0 ORM
- **Authentication**: Firebase Admin SDK (FCM push notifications)
- **File Storage**: Local filesystem (image uploads in `/uploads`)
- **Image Processing**: Sharp (resizing, optimization)
- **Form Handling**: Multer (multipart/form-data)
- **Validation**: Zod for request body schemas
- **CORS**: Enabled for cross-origin requests

## Directory Structure

```
/opt/agent-platform/
├── src/
│   ├── index.ts              # Express app setup, health endpoint, static pages
│   ├── router.ts             # Express Router singleton (routes register themselves)
│   ├── lib/                  # Shared utilities
│   │   ├── prisma.ts         # Prisma client with PG adapter
│   │   ├── firebase.ts       # Firebase initialization, FCM push
│   │   ├── auth.utils.ts     # Token generation, device auth, crypto
│   │   └── url.helpers.ts    # Build media file URLs
│   ├── routes/               # HTTP endpoint handlers
│   │   ├── users.ts          # User profile, avatar management
│   │   ├── family.ts         # Family CRUD, invites, member management
│   │   ├── devices.ts        # Device registration, telemetry, commands
│   │   ├── messaging.ts      # AAC messages and replies
│   │   ├── library.ts        # Library items (photos, ARASAAC icons), sets
│   │   ├── child-home.ts     # Child home nodes (menu/action tree)
│   │   └── arasaac.ts        # ARASAAC symbol search integration
│   ├── service/              # Business logic and schemas
│   │   ├── family.service.ts # Family creation, invites, auth flow
│   │   ├── family.types.ts   # Type definitions for family operations
│   │   ├── family.schemas.ts # Zod schemas for family endpoints
│   │   ├── child-home.schemas.ts
│   │   ├── devices.schemas.ts
│   │   └── storage.service.ts    # Local file storage abstraction
│   └── assets/               # Static HTML (privacy, account deletion pages)
├── prisma/
│   ├── schema.prisma         # Data model (11 models, 2 enums)
│   └── migrations/           # Timestamped migration files
├── dist/                     # Compiled JavaScript (git-ignored)
├── uploads/                  # User-uploaded files (git-ignored)
├── docker-compose.yml        # PostgreSQL + API services
├── Dockerfile                # Multi-stage build (Alpine, npm ci, tsc)
├── package.json              # Dependencies and npm scripts
├── tsconfig.json             # TypeScript config (strict, ES2022 target)
└── .env                      # Database, Firebase, and app configuration

```

## Data Model (Prisma Schema)

**Core Entities:**
- **Family**: Multi-user household (name, timestamps)
- **User**: Family member with role (PARENT/CHILD), avatar, devices
- **Device**: Physical device with stable `deviceId`, auth token hash, FCM token, telemetry
- **Invite**: Time-limited 6-char codes for joining families (one-time use)

**Communication:**
- **AacMessage**: Messages from one user to another (supports NORMAL and SEQUENCE modes)
- **AacReply**: Single reply per message with suggested replies

**Media Library:**
- **FamilyLibraryItem**: Photo or ARASAAC symbol (stored locally or referenced externally)
- **FamilyLibrarySet**: Grouped items with cover image and sort order

**Device Sync:**
- **DeviceState**: Battery%, volume%, charging status (per device)
- **DeviceSetting**: Key-value device settings (JSON values)
- **Telemetry**: Event logs from devices
- **Command**: Queue of commands to send to devices (status: queued/delivered/acked)

**UI Customization:**
- **ChildHomeNode**: Tree structure (parent/child relationships) for child-facing menu
  - Supports MENU (folder) and ACTION (clickable) types
  - Visibility controls, blink animations, target user filtering

Cascade deletes ensure cleanup when families/users are deleted.

## Architecture Patterns

### Authentication
- Device-based token auth via Bearer tokens (SHA256 hashed in DB)
- Routes import `authDevice()` middleware to extract device + user context
- User context attached to `req.auth` object with deviceId, userId, familyId, role

### Route Registration
- Each route file imports the singleton `router` from `router.ts`
- Routes auto-register via `.get()`, `.post()`, `.patch()`, etc. side-effects
- Imported in `index.ts` so they run during app startup
- No explicit route mounting needed

### Service Layer
- `FamilyService` handles complex family flows (create family, invites, join)
- Returns typed response objects with explicit status codes and body
- Used by route handlers to decouple HTTP from business logic

### Validation
- Zod schemas in `service/*.schemas.ts` for request body validation
- `.safeParse()` with error flattening on validation failure
- Prevents invalid data from reaching Prisma

### File Storage
- `LocalStorageService` abstraction for file operations
- Multer for multipart uploads to memory, then persisted to disk
- Sharp for image processing (EXIF orientation, resizing)
- Files stored in `/uploads` with storage key as relative path

### Device Sync
- Commands queued in database with status (queued → delivered → acked)
- FCM pushes alert parent devices about new commands
- Telemetry collected by POST endpoints, stored for analytics

## Build & Development Commands

```bash
# Install dependencies
npm install

# Development (auto-reload on file changes)
npm run dev

# Build TypeScript to JavaScript
npm run build

# Start production server (requires `npm run build` first)
npm start

# Docker (see docker-compose.yml)
docker-compose up        # Start PostgreSQL + API
docker-compose down      # Stop and remove containers
```

**Key Environment Variables** (see `.env`):
- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: API listen port (default 8080)
- `PUBLIC_BASE_URL`: Base URL for media file links (e.g., `http://localhost:8080`)
- `UPLOADS_DIR`: Directory to store uploaded files (default `/app/uploads`)
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`: FCM credentials

## Database Migrations

Prisma migrations are version-controlled in `prisma/migrations/`:
```bash
# Generate new migration after schema changes
npx prisma migrate dev --name <migration_name>

# Apply pending migrations
npx prisma migrate deploy

# Generate Prisma client (runs during Docker build)
npx prisma generate
```

## Testing

No test runner configured. Health check: `GET /health` returns `{ ok: true }`.

## Important Quirks & Constraints

1. **Router Registration**: Routes register as side-effects when imported. Order in `index.ts` doesn't matter, but all routes must be imported there.
2. **Token Hashing**: Tokens are SHA256 hashed before storage. Clients receive plain token, comparisons always use hashed version.
3. **Invite Codes**: 6-character uppercase alphanumeric (excludes I, O, 0, 1 to avoid confusion).
4. **File URLs**: Built dynamically from `PUBLIC_BASE_URL` + item ID. Must match actual file serving logic.
5. **Firebase Admin**: Initialized once per process; tokens must have `\n` escape sequences converted to actual newlines.
6. **Cascade Deletes**: Family deletion cascades to all users, devices, invites, messages, library items, etc.

## Deployment

- Dockerfile uses Node 20 Alpine base, npm ci for reproducible builds, tsc for compilation
- Environment variables injected at runtime (docker-compose or container orchestration)
- PostgreSQL runs alongside API in compose setup; production should use managed database
- Uploads directory should be mounted as persistent volume in production
