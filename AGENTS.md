# Contributor Notes

This repository contains the open-source edition of the MiaoJing AI creation platform.

Before changing code:

1. Prefer focused changes that follow the existing Next.js App Router, React, PostgreSQL, and PM2 structure.
2. Keep secrets out of source control. Use `.env.example` or `.env.docker.example` for placeholders only.
3. Run the relevant script or TypeScript check before submitting changes.
4. Update `README.md` when setup, deployment, API behavior, or operator workflow changes.
5. Do not commit generated output such as `.next/`, `dist/`, `node_modules/`, local storage, backups, or runtime `.env.local` files.
