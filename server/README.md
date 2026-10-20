# Materials Twin API

A small REST API over **MongoDB** or **Azure Cosmos DB for MongoDB**. The app talks to it through
`app/src/db/adapters.ts` when it is built with `VITE_API_URL`. Without that variable, as on GitHub
Pages, the app uses its built-in demo database instead (data kept in each visitor's browser), so
the public demo never touches real data.

## Run locally

```sh
cd server
npm install
export MONGODB_URI=mongodb://127.0.0.1:27017   # any MongoDB 6+ or Cosmos DB connection string
npm run seed                                   # load the sample data
ALLOW_RESET=true npm start                     # API on http://localhost:8080
```

Then run the app against it:

```sh
cd app
VITE_API_URL=http://localhost:8080 npm run dev
```

## Settings

| Variable | Default | |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | Connection string |
| `MONGODB_DB` | `materials_twin` | Database name |
| `PORT` | `8080` | |
| `CORS_ORIGIN` | `*` | Set to the app's origin in production |
| `ALLOW_RESET` | `false` | Enables `POST /api/_reset` (reseed). Never in production |

## Azure Cosmos DB for MongoDB

The code uses only standard MongoDB driver calls, so it runs on both Cosmos DB options:

- **vCore** (recommended): behaves like MongoDB. Copy the connection string from the portal into
  `MONGODB_URI` and run `npm run seed`.
- **RU-based**: also works. Notes:
  - Retryable writes are turned off in the client, because RU accounts don't support them.
  - Every sorted field needs an index. The API creates the indexes listed in
    `app/src/db/schema.ts` (`INDEXES`) on start.
  - For large data, create the collections as **sharded on `site`** before seeding. Every
    site-owned document carries `site`, so queries stay in one partition.
  - `insertMany` is batched (200 documents) to stay within request limits.

## Endpoints

| | |
|---|---|
| `GET /api/:coll?filter=&sort=&limit=&skip=` | `filter` and `sort` are JSON in MongoDB syntax; up to 5000 rows |
| `GET /api/:coll/:id` | One document |
| `POST /api/:coll` | Insert; `_id` (string) required; 409 if it exists |
| `PATCH /api/:coll/:id` | Body `{ "$set": { … } }` |
| `DELETE /api/:coll/:id` | |
| `GET /api/health` | |

Collections: `users`, `parts`, `locations`, `stockLots`, `movements`, `scrapCases`, `shipments`,
`carriers`, `approvalRules`, `alerts`, `auditLog`. The document shapes are in
`app/src/db/schema.ts`, and the server and the app share them.

Every write adds an `auditLog` entry with the `x-user` header. `$where`, `$function`,
`$accumulator` and `$expr` are rejected in filters.

## Before real users

- Put sign-in in front: **Microsoft Entra ID**, with Azure App Service Authentication or an
  API Management policy. Take the user from the validated token instead of `x-user`.
- Enforce roles on the server for approvals; the demo only checks them in the UI.
- Deploy with `npm start` on Azure App Service (Node 22) or as a container. Set `CORS_ORIGIN`,
  keep `ALLOW_RESET` unset, and store `MONGODB_URI` in Key Vault.

`npm run smoke` runs the end-to-end checks that CI runs against a MongoDB container.
