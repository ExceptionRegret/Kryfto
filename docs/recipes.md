# Recipes

## Format

Recipes are YAML or JSON documents validated by `RecipeSchema`.

Required fields:

- `id`
- `name`
- `version`
- `match.patterns`
- `requiresBrowser`

Optional fields:

- `steps` (Step DSL)
- `extraction` (`selectors` | `schema` | `plugin`)
- `throttling`
- `pluginPath`

## Built-in Examples

- `recipes/example-home.yaml`
- `recipes/iana-domains.yaml`
- `recipes/httpbin-headers-plugin.yaml`

Plugin example:

- `recipes/plugins/httpbin-headers-plugin.mjs`

## Step DSL

Supported steps:

- `goto(url)`
- `setHeaders(headers)`
- `setCookies(cookies)` / `exportCookies`
- `waitForSelector(selector, timeoutMs)`
- `click(selector)`
- `type(selector, text, secret?)`
- `scroll(direction, amount)`
- `wait(ms)`
- `waitForNetworkIdle(timeoutMs)`
- `paginate(nextSelector, maxPages, stopCondition?)`
- `screenshot(name)`
- `extract(mode=selectors|schema|plugin)`

## Validation

API:

- `POST /v1/recipes/validate`

CLI:

- `collector recipes validate <path>`

## Registry Behavior

- API loads built-in recipes from `recipes/`
- User recipes can be uploaded via `POST /v1/recipes` (admin)
- Mounted recipe directory can be set with `KRYFTO_RECIPES_DIR`
- **MCP Integration:** The MCP Server automatically polls `/v1/recipes` every 60 seconds and natively mounts all registered recipes as executable agent tools (e.g., `recipe_ycombinator`).
