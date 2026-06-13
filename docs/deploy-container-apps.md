# Deploy the Compass MCP server to Azure Container Apps

A stable hosted HTTPS endpoint for the MCP server — replaces the laptop +
dev tunnel. The `server/Dockerfile` seeds the vault at build time, so the
container is self-contained (`MODE=http`, port 3000, `VAULT_PATH=/app/vault`).

> **Critical:** pin to a **single replica** (`--min-replicas 1 --max-replicas 1`).
> The vault is per-container and uses a per-process write lock; multiple
> replicas would each hold a *different* ephemeral vault and the demo would
> see inconsistent state. One replica only.
>
> Container filesystem is ephemeral — vault commits reset on restart. Fine for
> the demo; do **not** engineer persistence.

Run these yourself (interactive Azure auth / infra mutations are gated to you).
`az` is installed and logged in to subscription `aed6bc98…` / `rg-jg-3018`.

## 0. One-time prerequisites

```bash
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
```

## 1. Container registry + cloud build

ACR name must be globally unique, lowercase alphanumeric:

```bash
az acr create -g rg-jg-3018 -n scoutcompassacr --sku Basic --admin-enabled true

# Build from the REPO ROOT with the server Dockerfile (its COPY paths are
# repo-root-relative). Cloud build — no local Docker needed.
cd ~/GitHub/scout-compass
az acr build -r scoutcompassacr -t scout-compass:latest -f server/Dockerfile .
```

## 2. Container Apps environment + app

```bash
az containerapp env create -g rg-jg-3018 -n scout-compass-env -l westus2

az containerapp create -g rg-jg-3018 -n scout-compass \
  --environment scout-compass-env \
  --image scoutcompassacr.azurecr.io/scout-compass:latest \
  --registry-server scoutcompassacr.azurecr.io \
  --target-port 3000 --ingress external \
  --min-replicas 1 --max-replicas 1 \
  --env-vars MODE=http PORT=3000 VAULT_PATH=/app/vault
```

## 3. Foundry IQ grounding (optional — query key as a secret, never plain env)

```bash
az containerapp secret set -g rg-jg-3018 -n scout-compass \
  --secrets foundry-iq-key="<AZURE AI SEARCH QUERY KEY>"

az containerapp update -g rg-jg-3018 -n scout-compass \
  --set-env-vars FOUNDRY_IQ_ENDPOINT=https://scout-compass-srch.search.windows.net \
                 FOUNDRY_IQ_KEY=secretref:foundry-iq-key \
                 FOUNDRY_IQ_KB=scout-compass-kb \
                 FOUNDRY_IQ_KS=ks-file-439 \
                 FOUNDRY_IQ_KS_KIND=file
```

## 4. Get the URL and verify

```bash
FQDN=$(az containerapp show -g rg-jg-3018 -n scout-compass \
  --query properties.configuration.ingress.fqdn -o tsv)
echo "https://$FQDN"

curl -s "https://$FQDN/healthz"                 # → {"ok":true,...}
curl -s -X POST "https://$FQDN/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'   # → 10 tools (with IQ) / 9 (without)
```

## 5. Cut over

- Re-point Atlas's MCP tool in Foundry from the dev-tunnel URL to `https://<FQDN>/mcp`.
- Update the endpoint references in `README.md` / `docs/architecture.svg` to the live host.
- The dev tunnel can stay as a warm fallback for recording.

## Teardown (after submission, to stop billing)

```bash
az containerapp delete -g rg-jg-3018 -n scout-compass --yes
az containerapp env delete -g rg-jg-3018 -n scout-compass-env --yes
az acr delete -g rg-jg-3018 -n scoutcompassacr --yes
```
