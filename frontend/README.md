# JXL Tools — Frontend

React + Vite + Tailwind CSS v4 frontend for JXL Tools.

## Development

```bash
# Install dependencies
npm install

# Start the dev server (port 3000)
# API calls are proxied to the FastAPI backend at http://127.0.0.1:8787
npm run dev
```

Start the backend in a separate terminal:

```bash
# From the repo root
jxl-tools serve
```

## Production Build

```bash
npm run build
```

The build output lands in `dist/` and is served automatically by the FastAPI backend via `jxl-tools serve`.
