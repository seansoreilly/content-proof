# ContentProof

ContentProof is a Next.js application for signing files with a Gmail‑verified
Ed25519 signature.  Users authenticate with Google, sign a file locally and
receive a signature that can be verified independently of the original file.

The repository contains the web interface and serverless API routes that power
the service.  Additional design documents are available in the
[documentation](./documentation) directory.

## Getting Started

Install dependencies and run the development server:

```bash
npm install
npm run dev
```

Open <http://localhost:3000> in your browser to view the app.

### Environment Variables

Create a `.env.local` file and provide the following values:

- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- `ED25519_PRIVATE_KEY` and `ED25519_PUBLIC_KEY`
- Optional `KV_REST_API_URL` and `KV_REST_API_TOKEN` for rate limiting

## Available Scripts

- `npm run dev` – start the development server
- `npm run build` – create a production build
- `npm start` – run the built app
- `npm run lint` – run ESLint

## Deployment

The project is ready to deploy on [Vercel](https://vercel.com/).  Run `vercel --prod`
or build locally with `npm run build` followed by `npm start`.
