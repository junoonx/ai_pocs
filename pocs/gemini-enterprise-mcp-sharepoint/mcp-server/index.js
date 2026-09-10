import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { createServer } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mammoth from "mammoth";
import officeParser from "officeparser";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Request context store for concurrency isolation across incoming HTTP requests
export const requestContext = new AsyncLocalStorage();

// Configuration flags
const IS_MOCK_MODE = process.env.MOCK_MODE === "true" || (!process.env.MS_GRAPH_TENANT_ID && !process.env.MS_GRAPH_CLIENT_SECRET);
const READ_ONLY_MODE = process.env.READ_ONLY_MODE === "true";
const ENABLE_DLP = process.env.ENABLE_DLP === "true";
const MAX_EXTRACTED_CHARS = parseInt(process.env.MAX_EXTRACTED_CHARS || "50000", 10);
const BLOCKED_PURVIEW_LABELS = (process.env.PURVIEW_BLOCKED_LABELS || "Restricted,Do Not Export,Highly Confidential").split(",").map(s => s.trim().toLowerCase());

// Load mock fixtures
let mockSites = [];
let mockFiles = [];
if (IS_MOCK_MODE) {
    try {
        const sitesPath = path.join(__dirname, "mock_data", "sites.json");
        const filesPath = path.join(__dirname, "mock_data", "files.json");
        if (fs.existsSync(sitesPath)) mockSites = JSON.parse(fs.readFileSync(sitesPath, "utf-8"));
        if (fs.existsSync(filesPath)) mockFiles = JSON.parse(fs.readFileSync(filesPath, "utf-8"));
        console.error(`[MOCK MODE] Initialized with ${mockSites.length} sites and ${mockFiles.length} mock files.`);
    } catch (err) {
        console.error(`[MOCK MODE] Failed to load mock fixtures:`, err.message);
    }
}

// In-memory cache for drive and site IDs (15-min TTL)
const cache = new Map();
function getCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > 15 * 60 * 1000) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}
function setCache(key, value) {
    cache.set(key, { value, timestamp: Date.now() });
}

// Microsoft Graph 429 Retry-After interceptor
axios.interceptors.response.use(
    res => res,
    async error => {
        const { config, response } = error;
        if (response && response.status === 429 && !config.__isRetry) {
            config.__isRetry = true;
            const retryAfterSec = parseInt(response.headers["retry-after"] || "2", 10);
            const waitMs = Math.min(retryAfterSec * 1000, 8000);
            console.warn(`[GRAPH 429] Rate limited by Microsoft Graph. Waiting ${waitMs}ms before retrying...`);
            await new Promise(r => setTimeout(r, waitMs));
            return axios(config);
        }
        return Promise.reject(error);
    }
);

// Resolve Microsoft Graph Authorization Headers
async function getGraphHeaders() {
    const store = requestContext.getStore() || {};
    const authHeader = store.authHeader;

    if (authHeader && authHeader.toLowerCase().startsWith("bearer ") && !authHeader.includes("mock")) {
        return {
            Authorization: authHeader,
            Accept: "application/json"
        };
    }

    if (IS_MOCK_MODE) {
        return {
            Authorization: "Bearer mock_graph_token",
            Accept: "application/json"
        };
    }

    const tenantId = process.env.MS_GRAPH_TENANT_ID;
    const clientId = process.env.MS_GRAPH_CLIENT_ID;
    const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
        throw new Error("Missing Microsoft Graph credentials. Configure MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, and MS_GRAPH_CLIENT_SECRET or set MOCK_MODE=true.");
    }

    try {
        const tokenRes = await axios.post(
            `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
            new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                scope: "https://graph.microsoft.com/.default",
                grant_type: "client_credentials"
            }),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );
        return {
            Authorization: `Bearer ${tokenRes.data.access_token}`,
            Accept: "application/json"
        };
    } catch (err) {
        console.error("[AUTH ERROR] Microsoft Entra ID token retrieval failed:", err.message);
        throw new Error(`Entra ID token acquisition failed: ${err.message}`);
    }
}

// Cloud DLP / Sensitive Data Protection Redaction
async function redactSensitiveData(rawText) {
    if (!ENABLE_DLP) {
        // Fallback local regex redaction for common PII patterns
        return rawText
            .replace(/\b(?:\d{4}[ -]?){3}\d{4}\b/g, "[REDACTED_CREDIT_CARD]")
            .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]");
    }

    try {
        const { DlpServiceClient } = await import("@google-cloud/dlp");
        const dlpClient = new DlpServiceClient();
        const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
        if (!projectId) return rawText;

        const [response] = await dlpClient.deidentifyContent({
            parent: `projects/${projectId}/locations/global`,
            deidentifyConfig: {
                infoTypeTransformations: {
                    transformations: [{
                        primitiveTransformation: {
                            replaceWithInfoTypeConfig: {}
                        }
                    }]
                }
            },
            inspectConfig: {
                infoTypes: [
                    { name: "CREDIT_CARD_NUMBER" },
                    { name: "US_SOCIAL_SECURITY_NUMBER" },
                    { name: "EMAIL_ADDRESS" },
                    { name: "PHONE_NUMBER" }
                ],
                minLikelihood: "POSSIBLE"
            },
            item: { value: rawText }
        });
        return response.item.value;
    } catch (err) {
        console.warn("[DLP WARNING] Google Cloud DLP failed, applying local fallback redaction:", err.message);
        return rawText
            .replace(/\b(?:\d{4}[ -]?){3}\d{4}\b/g, "[REDACTED_CREDIT_CARD]")
            .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]");
    }
}

// In-Memory Multi-Format Document Text Extractor
async function extractDocumentText(bufferData, fileName, mimeType = "") {
    let text = "";
    const lowerName = fileName.toLowerCase();

    if (lowerName.endsWith(".docx") || mimeType.includes("wordprocessingml")) {
        const result = await mammoth.extractRawText({ buffer: bufferData });
        text = result.value;
    } else if (lowerName.endsWith(".pptx") || lowerName.endsWith(".xlsx") || mimeType.includes("presentationml") || mimeType.includes("spreadsheetml")) {
        text = await officeParser.parseOfficeAsync(bufferData);
    } else if (lowerName.endsWith(".pdf") || mimeType.includes("pdf")) {
        const pdfResult = await pdfParse(bufferData);
        text = pdfResult.text;
    } else {
        text = bufferData.toString("utf-8");
    }

    if (text.length > MAX_EXTRACTED_CHARS) {
        text = text.substring(0, MAX_EXTRACTED_CHARS) + `\n\n[TRUNCATED: Document exceeds ${MAX_EXTRACTED_CHARS} character budget.]`;
    }
    return text.trim();
}

// ============================================================================
// MCP Server Initialization (Singleton Pattern with Concurrency Safety)
// ============================================================================

export const mcpServer = new Server(
    { name: "gemini-enterprise-sharepoint-mcp-server", version: "2.0.0" },
    { capabilities: { tools: {}, resources: {} } }
);

// Define the 12 Enterprise Tools
const TOOLS_DEFINITIONS = [
    {
        name: "sharepoint_search_files",
        description: "Searches for SharePoint and OneDrive files matching keywords or full-text query with metadata and site references.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search terms or file name." }
            },
            required: ["query"]
        }
    },
    {
        name: "sharepoint_list_sites",
        description: "Discovers corporate SharePoint sites across the organization.",
        inputSchema: {
            type: "object",
            properties: {
                search: { type: "string", description: "Optional filter for site name or keyword." }
            }
        }
    },
    {
        name: "sharepoint_list_libraries",
        description: "Lists document libraries and drives within a specific SharePoint site.",
        inputSchema: {
            type: "object",
            properties: {
                siteId: { type: "string", description: "Target site ID or display name." }
            },
            required: ["siteId"]
        }
    },
    {
        name: "sharepoint_list_items",
        description: "Lists folders and files inside a SharePoint document drive or specific folder path.",
        inputSchema: {
            type: "object",
            properties: {
                driveId: { type: "string", description: "The drive ID." },
                folderPath: { type: "string", description: "Relative folder path (default root)." }
            },
            required: ["driveId"]
        }
    },
    {
        name: "sharepoint_get_file_metadata",
        description: "Retrieves properties, size, modified dates, webUrl, and Microsoft Purview sensitivity labels for a file.",
        inputSchema: {
            type: "object",
            properties: {
                driveId: { type: "string", description: "Target drive ID." },
                itemId: { type: "string", description: "Target item ID." }
            },
            required: ["driveId", "itemId"]
        }
    },
    {
        name: "sharepoint_read_file",
        description: "Extracts and streams readable text from Word (.docx), PowerPoint (.pptx), Excel (.xlsx), PDF, and text files with zero copy and DLP redaction.",
        inputSchema: {
            type: "object",
            properties: {
                driveId: { type: "string", description: "Target drive ID." },
                itemId: { type: "string", description: "Target item ID." }
            },
            required: ["driveId", "itemId"]
        }
    },
    {
        name: "sharepoint_download_url",
        description: "Generates a direct pre-authenticated download URL for a file in SharePoint.",
        inputSchema: {
            type: "object",
            properties: {
                driveId: { type: "string", description: "The drive ID." },
                itemId: { type: "string", description: "The item ID." }
            },
            required: ["driveId", "itemId"]
        }
    },
    {
        name: "sharepoint_upload_file",
        description: "Uploads a text or binary file to a SharePoint library folder.",
        inputSchema: {
            type: "object",
            properties: {
                driveId: { type: "string", description: "Target drive ID." },
                folderPath: { type: "string", description: "Target folder path." },
                fileName: { type: "string", description: "File name with extension." },
                content: { type: "string", description: "File content string." }
            },
            required: ["driveId", "fileName", "content"]
        }
    },
    {
        name: "sharepoint_create_folder",
        description: "Creates a new folder inside a SharePoint drive.",
        inputSchema: {
            type: "object",
            properties: {
                driveId: { type: "string", description: "Target drive ID." },
                parentPath: { type: "string", description: "Parent directory path." },
                folderName: { type: "string", description: "Name of folder to create." }
            },
            required: ["driveId", "folderName"]
        }
    },
    {
        name: "sharepoint_update_file",
        description: "Updates or overwrites the content of an existing SharePoint file.",
        inputSchema: {
            type: "object",
            properties: {
                driveId: { type: "string", description: "Target drive ID." },
                itemId: { type: "string", description: "Target item ID." },
                content: { type: "string", description: "Updated content." }
            },
            required: ["driveId", "itemId", "content"]
        }
    },
    {
        name: "sharepoint_rename_item",
        description: "Renames an existing file or folder in SharePoint.",
        inputSchema: {
            type: "object",
            properties: {
                driveId: { type: "string", description: "Target drive ID." },
                itemId: { type: "string", description: "Target item ID." },
                newName: { type: "string", description: "New display name." }
            },
            required: ["driveId", "itemId", "newName"]
        }
    },
    {
        name: "sharepoint_delete_item",
        description: "Deletes a file or folder from SharePoint under corporate compliance control.",
        inputSchema: {
            type: "object",
            properties: {
                driveId: { type: "string", description: "Target drive ID." },
                itemId: { type: "string", description: "Target item ID." }
            },
            required: ["driveId", "itemId"]
        }
    }
];

// Register Tools List Handler
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS_DEFINITIONS };
});

// Register Tool Execution Handler
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const headers = await getGraphHeaders();

    try {
        // Enforce Read-Only mode safety switch
        if (READ_ONLY_MODE && ["sharepoint_upload_file", "sharepoint_create_folder", "sharepoint_update_file", "sharepoint_rename_item", "sharepoint_delete_item"].includes(name)) {
            return {
                content: [{ type: "text", text: `[OPERATION BLOCKED] Server is operating in READ_ONLY_MODE. Mutation operation '${name}' was rejected.` }],
                isError: true
            };
        }

        // ====================================================================
        // 1. Search Files
        // ====================================================================
        if (name === "sharepoint_search_files") {
            const query = (args.query || "").toLowerCase();
            if (IS_MOCK_MODE) {
                const hits = mockFiles.filter(f => f.name.toLowerCase().includes(query) || f.content.toLowerCase().includes(query));
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(hits.map(h => ({
                            id: h.id,
                            name: h.name,
                            driveId: h.driveId,
                            size: h.size,
                            lastModified: h.lastModifiedDateTime,
                            webUrl: h.webUrl,
                            purviewLabel: h.sensitivityLabel?.displayName || "Unlabeled"
                        })), null, 2)
                    }]
                };
            }

            // Production Microsoft Graph Search API
            const searchRes = await axios.post("https://graph.microsoft.com/v1.0/search/query", {
                requests: [{
                    entityTypes: ["driveItem"],
                    query: { queryString: args.query },
                    from: 0,
                    size: 15,
                    fields: ["id", "name", "size", "webUrl", "parentReference", "lastModifiedDateTime", "sensitivityLabel"]
                }]
            }, { headers });

            const hits = searchRes.data.value[0]?.hitsContainers[0]?.hits || [];
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(hits.map(h => ({
                        id: h.resource.id,
                        name: h.resource.name,
                        driveId: h.resource.parentReference?.driveId,
                        size: h.resource.size,
                        lastModified: h.resource.lastModifiedDateTime,
                        webUrl: h.resource.webUrl,
                        purviewLabel: h.resource.sensitivityLabel?.displayName || "Unlabeled"
                    })), null, 2)
                }]
            };
        }

        // ====================================================================
        // 2. List Sites
        // ====================================================================
        if (name === "sharepoint_list_sites") {
            if (IS_MOCK_MODE) {
                return { content: [{ type: "text", text: JSON.stringify(mockSites, null, 2) }] };
            }
            const filter = args.search ? `?search=${encodeURIComponent(args.search)}` : "";
            const res = await axios.get(`https://graph.microsoft.com/v1.0/sites${filter}`, { headers });
            return { content: [{ type: "text", text: JSON.stringify(res.data.value, null, 2) }] };
        }

        // ====================================================================
        // 3. List Libraries (Drives)
        // ====================================================================
        if (name === "sharepoint_list_libraries") {
            if (IS_MOCK_MODE) {
                const site = mockSites.find(s => s.id === args.siteId || s.name.toLowerCase().includes(args.siteId.toLowerCase()));
                return { content: [{ type: "text", text: JSON.stringify(site ? site.drives : [], null, 2) }] };
            }
            const res = await axios.get(`https://graph.microsoft.com/v1.0/sites/${args.siteId}/drives`, { headers });
            return { content: [{ type: "text", text: JSON.stringify(res.data.value, null, 2) }] };
        }

        // ====================================================================
        // 4. List Items
        // ====================================================================
        if (name === "sharepoint_list_items") {
            if (IS_MOCK_MODE) {
                const files = mockFiles.filter(f => f.driveId === args.driveId);
                return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
            }
            const pathUrl = args.folderPath ? `root:/${encodeURIComponent(args.folderPath)}:/children` : "root/children";
            const res = await axios.get(`https://graph.microsoft.com/v1.0/drives/${args.driveId}/${pathUrl}`, { headers });
            return { content: [{ type: "text", text: JSON.stringify(res.data.value, null, 2) }] };
        }

        // ====================================================================
        // 5. Get File Metadata (with Purview Pre-Flight Inspection)
        // ====================================================================
        if (name === "sharepoint_get_file_metadata") {
            if (IS_MOCK_MODE) {
                const file = mockFiles.find(f => f.id === args.itemId || f.name.toLowerCase() === args.itemId.toLowerCase());
                if (!file) throw new Error(`File '${args.itemId}' not found in mock drive.`);
                return { content: [{ type: "text", text: JSON.stringify(file, null, 2) }] };
            }

            const res = await axios.get(`https://graph.microsoft.com/v1.0/drives/${args.driveId}/items/${args.itemId}?$select=id,name,size,webUrl,createdDateTime,lastModifiedDateTime,sensitivityLabel,file`, { headers });
            return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
        }

        // ====================================================================
        // 6. Read File (Zero Copy + Purview Guardrail + Cloud DLP)
        // ====================================================================
        if (name === "sharepoint_read_file") {
            if (IS_MOCK_MODE) {
                const file = mockFiles.find(f => f.id === args.itemId || f.name.toLowerCase() === args.itemId.toLowerCase());
                if (!file) throw new Error(`Document '${args.itemId}' not found.`);

                // Purview Check
                if (file.isRmsProtected || (file.sensitivityLabel && BLOCKED_PURVIEW_LABELS.some(l => file.sensitivityLabel.displayName.toLowerCase().includes(l)))) {
                    return {
                        content: [{
                            type: "text",
                            text: `[PURVIEW BLOCKED] Document '${file.name}' is classified under Microsoft Purview as '${file.sensitivityLabel?.displayName || "Confidential (RMS)"}'. Content extraction blocked by enterprise governance policy.`
                        }],
                        isError: true
                    };
                }

                const redacted = await redactSensitiveData(file.content);
                return {
                    content: [{
                        type: "text",
                        text: `--- [START DOCUMENT: ${file.name}] ---\nPurview Label: ${file.sensitivityLabel?.displayName || "Unlabeled"}\nURL: ${file.webUrl}\n\n${redacted}\n--- [END DOCUMENT] ---`
                    }]
                };
            }

            // Production: Metadata & Purview Pre-Flight Check
            const metaRes = await axios.get(`https://graph.microsoft.com/v1.0/drives/${args.driveId}/items/${args.itemId}?$select=id,name,size,sensitivityLabel,file`, { headers });
            const item = metaRes.data;
            const labelName = item.sensitivityLabel?.displayName || "";

            // Check if label triggers Purview restriction
            if (labelName && BLOCKED_PURVIEW_LABELS.some(b => labelName.toLowerCase().includes(b))) {
                return {
                    content: [{
                        type: "text",
                        text: `[PURVIEW POLICY RESTRICTION] Document '${item.name}' is protected by Microsoft Purview sensitivity label '${labelName}'. Content extraction is blocked under zero-copy enterprise governance.`
                    }],
                    isError: true
                };
            }

            // Fetch volatile binary buffer into RAM (Max 15MB limit)
            if (item.size && item.size > 15 * 1024 * 1024) {
                return {
                    content: [{ type: "text", text: `[SIZE LIMIT] Document '${item.name}' (${Math.round(item.size / 1024 / 1024)}MB) exceeds the 15MB real-time extraction limit.` }],
                    isError: true
                };
            }

            const downloadRes = await axios.get(`https://graph.microsoft.com/v1.0/drives/${args.driveId}/items/${args.itemId}/content`, {
                headers,
                responseType: "arraybuffer"
            });

            const buffer = Buffer.from(downloadRes.data);
            const extractedText = await extractDocumentText(buffer, item.name, item.file?.mimeType || "");
            const redactedText = await redactSensitiveData(extractedText);

            return {
                content: [{
                    type: "text",
                    text: `--- [START DOCUMENT: ${item.name}] ---\nPurview Label: ${labelName || "Unlabeled"}\n\n${redactedText}\n--- [END DOCUMENT] ---`
                }]
            };
        }

        // ====================================================================
        // 7. Get Direct Download URL
        // ====================================================================
        if (name === "sharepoint_download_url") {
            if (IS_MOCK_MODE) {
                const file = mockFiles.find(f => f.id === args.itemId);
                return { content: [{ type: "text", text: file ? file.webUrl : "https://company.sharepoint.com/mock-download" }] };
            }
            const res = await axios.get(`https://graph.microsoft.com/v1.0/drives/${args.driveId}/items/${args.itemId}?$select=@microsoft.graph.downloadUrl`, { headers });
            return { content: [{ type: "text", text: res.data["@microsoft.graph.downloadUrl"] || res.data.webUrl }] };
        }

        // ====================================================================
        // 8. Upload File (Create File)
        // ====================================================================
        if (name === "sharepoint_upload_file") {
            if (IS_MOCK_MODE) {
                const newFile = {
                    id: `file-mock-${Date.now()}`,
                    name: args.fileName,
                    driveId: args.driveId,
                    size: Buffer.byteLength(args.content),
                    lastModifiedDateTime: new Date().toISOString(),
                    webUrl: `https://company.sharepoint.com/mock/${args.fileName}`,
                    content: args.content
                };
                mockFiles.push(newFile);
                return { content: [{ type: "text", text: `[MOCK UPLOAD SUCCESS] File '${args.fileName}' created with ID '${newFile.id}'.` }] };
            }
            const pathUrl = args.folderPath ? `root:/${encodeURIComponent(args.folderPath)}/${encodeURIComponent(args.fileName)}:/content` : `root:/${encodeURIComponent(args.fileName)}:/content`;
            const res = await axios.put(`https://graph.microsoft.com/v1.0/drives/${args.driveId}/${pathUrl}`, args.content, {
                headers: { ...headers, "Content-Type": "text/plain" }
            });
            return { content: [{ type: "text", text: `File uploaded successfully. Item ID: ${res.data.id}` }] };
        }

        // ====================================================================
        // 9. Create Folder
        // ====================================================================
        if (name === "sharepoint_create_folder") {
            if (IS_MOCK_MODE) {
                return { content: [{ type: "text", text: `[MOCK] Folder '${args.folderName}' created in drive '${args.driveId}'.` }] };
            }
            const pathUrl = args.parentPath ? `root:/${encodeURIComponent(args.parentPath)}:/children` : "root/children";
            const res = await axios.post(`https://graph.microsoft.com/v1.0/drives/${args.driveId}/${pathUrl}`, {
                name: args.folderName,
                folder: {},
                "@microsoft.graph.conflictBehavior": "rename"
            }, { headers });
            return { content: [{ type: "text", text: `Folder created. ID: ${res.data.id}` }] };
        }

        // ====================================================================
        // 10. Update File
        // ====================================================================
        if (name === "sharepoint_update_file") {
            if (IS_MOCK_MODE) {
                const file = mockFiles.find(f => f.id === args.itemId);
                if (file) file.content = args.content;
                return { content: [{ type: "text", text: `[MOCK] File '${args.itemId}' updated.` }] };
            }
            await axios.put(`https://graph.microsoft.com/v1.0/drives/${args.driveId}/items/${args.itemId}/content`, args.content, {
                headers: { ...headers, "Content-Type": "text/plain" }
            });
            return { content: [{ type: "text", text: `File '${args.itemId}' updated successfully.` }] };
        }

        // ====================================================================
        // 11. Rename Item
        // ====================================================================
        if (name === "sharepoint_rename_item") {
            if (IS_MOCK_MODE) {
                const file = mockFiles.find(f => f.id === args.itemId);
                if (file) file.name = args.newName;
                return { content: [{ type: "text", text: `[MOCK] Renamed item '${args.itemId}' to '${args.newName}'.` }] };
            }
            const res = await axios.patch(`https://graph.microsoft.com/v1.0/drives/${args.driveId}/items/${args.itemId}`, {
                name: args.newName
            }, { headers });
            return { content: [{ type: "text", text: `Item renamed to '${res.data.name}'.` }] };
        }

        // ====================================================================
        // 12. Delete Item
        // ====================================================================
        if (name === "sharepoint_delete_item") {
            if (IS_MOCK_MODE) {
                mockFiles = mockFiles.filter(f => f.id !== args.itemId);
                return { content: [{ type: "text", text: `[MOCK] Deleted item '${args.itemId}'.` }] };
            }
            await axios.delete(`https://graph.microsoft.com/v1.0/drives/${args.driveId}/items/${args.itemId}`, { headers });
            return { content: [{ type: "text", text: `Item '${args.itemId}' deleted successfully.` }] };
        }

        throw new Error(`Unknown tool: ${name}`);
    } catch (err) {
        console.error(`[TOOL ERROR] Tool '${name}' failed:`, err.message);
        return {
            content: [{ type: "text", text: `Error executing ${name}: ${err.message}` }],
            isError: true
        };
    }
});

// ============================================================================
// HTTP Server & Concurrency-Safe Transport Dispatcher
// ============================================================================

const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
await mcpServer.connect(transport);

const server = createServer(async (req, res) => {
    // Normalize Cloud Run headers
    const reqProxy = new Proxy(req, {
        get(target, prop, receiver) {
            if (prop === "headers") {
                return {
                    ...target.headers,
                    accept: "application/json, text/event-stream"
                };
            }
            return Reflect.get(target, prop, receiver);
        }
    });

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    // Main MCP Endpoint (Isolated in AsyncLocalStorage context)
    if (url.pathname === "/mcp") {
        await requestContext.run({ authHeader: req.headers.authorization }, async () => {
            await transport.handleRequest(reqProxy, res);
        });
        return;
    }

    // Health Checks
    if (url.pathname === "/" || url.pathname === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            status: "healthy",
            service: "gemini-enterprise-sharepoint-mcp-server",
            version: "2.0.0",
            mode: IS_MOCK_MODE ? "mock_sandbox" : "live_graph",
            readOnly: READ_ONLY_MODE,
            dlpEnabled: ENABLE_DLP
        }));
        return;
    }

    // Mock OAuth 2.0 endpoints for sandbox console verification
    if (url.pathname === "/auth") {
        const redirect_uri = url.searchParams.get("redirect_uri");
        const state = url.searchParams.get("state");
        res.statusCode = 302;
        res.setHeader("Location", `${redirect_uri}?code=mock_auth_code&state=${state}`);
        res.end();
        return;
    }

    if (url.pathname === "/token") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
            access_token: "mock_access_token",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "mock_refresh_token"
        }));
        return;
    }

    res.statusCode = 404;
    res.end("Not Found");
});

const PORT = parseInt(process.env.PORT || "3000", 10);
server.listen(PORT, () => {
    console.error(`🚀 Enterprise SharePoint MCP Server v2.0 running on port ${PORT}`);
    console.error(`Mode: ${IS_MOCK_MODE ? "STANDALONE MOCK SANDBOX" : "LIVE MICROSOFT GRAPH"} | Read-Only: ${READ_ONLY_MODE} | DLP: ${ENABLE_DLP}`);
});
