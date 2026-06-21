// Schema mapping
export { jsonSchemaToTypeRef, inputSchemaToParams, type JsonSchema } from "./schema/json-schema-to-type.js";

// Upstream
export { ConnectionManager, type UpstreamSpec } from "./upstream/connection-manager.js";
export { introspect } from "./upstream/introspect.js";
export {
  defaultEffectClassifier,
  type EffectClassifier,
  type ClassifiableTool,
} from "./upstream/effect.js";

// Tool provider
export { GatewayToolProvider, extractResult } from "./tool-provider.js";

// MCP server surface
export { runTask, type RunTaskDeps } from "./mcp-server/run-task.js";
export { createMcpServer } from "./mcp-server/server.js";
