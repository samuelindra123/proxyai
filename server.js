require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const DO_BASE_URL = process.env.DO_BASE_URL || "https://inference.do-ai.run";
const DO_CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
const DO_MODEL_ACCESS_KEY =
  process.env.DO_MODEL_ACCESS_KEY || process.env.DIGITALOCEAN_MODEL_ACCESS_KEY || "";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "glm-5";
const GATEWAY_API_TOKEN = process.env.GATEWAY_API_TOKEN || "";

if (!DO_MODEL_ACCESS_KEY) {
  console.warn(
    "[WARN] Missing DO_MODEL_ACCESS_KEY (or DIGITALOCEAN_MODEL_ACCESS_KEY). Requests to upstream will fail until it is set."
  );
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function getBearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== "string") return "";
  const [scheme, token] = authorizationHeader.split(" ");
  if (!scheme || !token) return "";
  if (scheme.toLowerCase() !== "bearer") return "";
  return token.trim();
}

function isAuthorizedClient(req) {
  if (!GATEWAY_API_TOKEN) return true;

  const bearerToken = getBearerToken(req.headers.authorization);
  const xApiKeyToken = typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"].trim() : "";

  return bearerToken === GATEWAY_API_TOKEN || xApiKeyToken === GATEWAY_API_TOKEN;
}

function requireGatewayToken(req, res, next) {
  if (isAuthorizedClient(req)) {
    next();
    return;
  }

  res.status(401).json({
    error: {
      type: "authentication_error",
      message: "Unauthorized: invalid or missing gateway API token",
    },
  });
}

function buildUpstreamHeaders(extraHeaders = {}) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${DO_MODEL_ACCESS_KEY}`,
    ...extraHeaders,
  };
}

function createGatewayError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  error.payload = {
    error: {
      type: status >= 500 ? "api_error" : "invalid_request_error",
      message,
      ...(details ? { details } : {}),
    },
  };
  return error;
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

function normalizeContentValue(value) {
  if (typeof value === "string") {
    return cleanText(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => normalizeContentValue(item))
      .filter(Boolean);
    return cleanText(parts.join("\n"));
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  if (typeof value.text === "string") {
    return cleanText(value.text);
  }

  if (typeof value.content === "string") {
    return cleanText(value.content);
  }

  if (Array.isArray(value.content)) {
    return normalizeContentValue(value.content);
  }

  if (typeof value.value === "string") {
    return cleanText(value.value);
  }

  return "";
}

function normalizeAssistantText(value) {
  if (typeof value === "string") {
    return cleanText(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((block) => {
        if (!block) return "";
        if (typeof block === "string") return block;
        if (block.type === "text" && typeof block.text === "string") return block.text;
        if (typeof block.text === "string") return block.text;
        if (typeof block.content === "string") return block.content;
        if (Array.isArray(block.content)) return normalizeAssistantText(block.content);
        return "";
      })
      .filter(Boolean);

    return cleanText(parts.join("\n"));
  }

  if (value && typeof value === "object") {
    if (typeof value.text === "string") return cleanText(value.text);
    if (typeof value.content === "string") return cleanText(value.content);
    if (Array.isArray(value.content)) return normalizeAssistantText(value.content);
  }

  return "";
}

function mapClientModelToUpstream() {
  return DEFAULT_MODEL;
}

async function requestDigitalOceanChatCompletions(payload) {
  const response = await fetch(`${DO_BASE_URL}${DO_CHAT_COMPLETIONS_PATH}`, {
    method: "POST",
    headers: buildUpstreamHeaders(),
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }

  if (!response.ok) {
    const err = new Error("Upstream request failed");
    err.status = response.status;
    err.payload = parsed;
    throw err;
  }

  return parsed;
}

function extractAssistantContent(openAIResponse) {
  const choice = openAIResponse?.choices?.[0];
  if (!choice || typeof choice !== "object") return "";

  const messageContent = normalizeAssistantText(choice?.message?.content);
  if (messageContent) return messageContent;

  const textContent = normalizeAssistantText(choice?.text);
  if (textContent) return textContent;

  return "";
}

async function requestWithContentRecovery(payload) {
  const firstResponse = await requestDigitalOceanChatCompletions(payload);
  const firstText = extractAssistantContent(firstResponse);

  if (firstText) {
    return { upstreamResponse: firstResponse, assistantText: firstText, retried: false };
  }

  const retryPayload = {
    ...payload,
    messages: [
      {
        role: "system",
        content: "Provide a direct final answer in message.content. Do not output reasoning.",
      },
      ...(Array.isArray(payload.messages) ? payload.messages : []),
    ],
    stream: false,
  };

  const retryResponse = await requestDigitalOceanChatCompletions(retryPayload);
  const retryText = extractAssistantContent(retryResponse);

  if (retryText) {
    return { upstreamResponse: retryResponse, assistantText: retryText, retried: true };
  }

  throw createGatewayError(
    502,
    "Upstream returned no valid assistant content in choices[0].message.content or choices[0].text after one retry."
  );
}

function anthropicBlocksToText(content) {
  return normalizeContentValue(content);
}

function anthropicToOpenAIMessages(body) {
  const output = [];

  if (typeof body.system === "string" && cleanText(body.system)) {
    output.push({ role: "system", content: cleanText(body.system) });
  } else if (Array.isArray(body.system)) {
    const systemText = normalizeContentValue(body.system);
    if (systemText) output.push({ role: "system", content: systemText });
  } else if (body.system && typeof body.system === "object") {
    const systemText = normalizeContentValue(body.system);
    if (systemText) output.push({ role: "system", content: systemText });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];

  for (const message of messages) {
    if (!message || typeof message !== "object" || !message.role) continue;

    const content = anthropicBlocksToText(message.content);

    output.push({
      role: message.role,
      content,
    });
  }

  return output;
}

function normalizeChatMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((message) => message && typeof message === "object" && message.role)
    .map((message) => ({
      ...message,
      content: normalizeContentValue(message.content),
    }));
}

function mapFinishReasonToAnthropicStopReason(finishReason) {
  if (finishReason === "stop") return "end_turn";
  if (finishReason === "length") return "max_tokens";
  return "end_turn";
}

function buildAnthropicResponse(modelName, openAIResponse, assistantText) {
  const choice = openAIResponse?.choices?.[0] || {};
  const usage = openAIResponse?.usage || {};

  return {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: modelName,
    content: [{ type: "text", text: assistantText }],
    stop_reason: mapFinishReasonToAnthropicStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: Number(usage.prompt_tokens || 0),
      output_tokens: Number(usage.completion_tokens || 0),
    },
  };
}

function buildChatCompletionsResponse(openAIResponse, assistantText, requestedModel, upstreamModel) {
  const cloned = openAIResponse && typeof openAIResponse === "object" ? JSON.parse(JSON.stringify(openAIResponse)) : {};
  const choice = cloned?.choices?.[0];

  if (choice && typeof choice === "object") {
    if (!choice.message || typeof choice.message !== "object") {
      choice.message = { role: "assistant", content: assistantText };
    } else {
      choice.message.role = choice.message.role || "assistant";
      choice.message.content = assistantText;
    }

    if ("text" in choice) {
      choice.text = assistantText;
    }
  }

  if (requestedModel) {
    cloned.model = requestedModel;
  } else if (upstreamModel) {
    cloned.model = upstreamModel;
  }

  return cloned;
}

function writeSSE(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendAnthropicStreamFromText(res, anthropicResponse) {
  const text = anthropicResponse?.content?.[0]?.text || "";

  writeSSE(res, "message_start", {
    type: "message_start",
    message: {
      id: anthropicResponse.id,
      type: "message",
      role: "assistant",
      model: anthropicResponse.model,
      content: [],
      usage: { input_tokens: anthropicResponse.usage.input_tokens, output_tokens: 0 },
    },
  });

  writeSSE(res, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });

  writeSSE(res, "content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  });

  writeSSE(res, "content_block_stop", { type: "content_block_stop", index: 0 });

  writeSSE(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: anthropicResponse.stop_reason, stop_sequence: null },
    usage: { output_tokens: anthropicResponse.usage.output_tokens },
  });

  writeSSE(res, "message_stop", { type: "message_stop" });
  res.end();
}

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "do-glm5-gateway" });
});

app.get("/v1/models", requireGatewayToken, (req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: DEFAULT_MODEL,
        object: "model",
        created: 0,
        owned_by: "digitalocean",
      },
    ],
  });
});

app.post("/v1/chat/completions", requireGatewayToken, async (req, res) => {
  try {
    const body = req.body || {};
    const requestedModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
    const upstreamModel = mapClientModelToUpstream(requestedModel);

    const payload = {
      ...body,
      model: upstreamModel,
      messages: normalizeChatMessages(body.messages),
      max_tokens: body.max_tokens || 512,
      stream: false,
    };

    const { upstreamResponse, assistantText } = await requestWithContentRecovery(payload);
    const response = buildChatCompletionsResponse(upstreamResponse, assistantText, requestedModel, upstreamModel);

    res.status(200).json(response);
  } catch (error) {
    const status = error.status || 500;
    const message = error.payload || { error: { type: "api_error", message: error.message || "Unknown error" } };
    res.status(status).json(message);
  }
});

app.post("/v1/messages", requireGatewayToken, async (req, res) => {
  try {
    const body = req.body || {};
    const requestedModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
    const upstreamModel = mapClientModelToUpstream(requestedModel);

    const upstreamPayload = {
      model: upstreamModel,
      messages: anthropicToOpenAIMessages(body),
      max_tokens: body.max_tokens || 512,
      temperature: body.temperature,
      top_p: body.top_p,
      stop: body.stop_sequences,
      stream: false,
    };

    const { upstreamResponse, assistantText } = await requestWithContentRecovery(upstreamPayload);
    const anthropicResponse = buildAnthropicResponse(requestedModel, upstreamResponse, assistantText);

    if (body.stream === true) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      sendAnthropicStreamFromText(res, anthropicResponse);
      return;
    }

    res.status(200).json(anthropicResponse);
  } catch (error) {
    const status = error.status || 500;
    const message = error.payload || { error: { type: "api_error", message: error.message || "Unknown error" } };
    res.status(status).json(message);
  }
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Gateway listening on http://${HOST}:${PORT}`);
  });
}

module.exports = app;
