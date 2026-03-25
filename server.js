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
  return openAIResponse?.choices?.[0]?.message?.content;
}

async function requestWithContentRecovery(payload) {
  const first = await requestDigitalOceanChatCompletions(payload);

  if (typeof extractAssistantContent(first) === "string" && extractAssistantContent(first).trim() !== "") {
    return first;
  }

  const retryMessages = [
    {
      role: "system",
      content:
        "Provide a direct final answer in message.content. Keep it concise and do not output internal reasoning.",
    },
    ...(Array.isArray(payload.messages) ? payload.messages : []),
  ];

  const retryPayload = {
    ...payload,
    messages: retryMessages,
    max_tokens: Math.max(Number(payload.max_tokens || 0), 512),
    reasoning_effort: payload.reasoning_effort || "low",
  };

  return requestDigitalOceanChatCompletions(retryPayload);
}

function anthropicBlocksToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function anthropicToOpenAIMessages(body) {
  const output = [];

  if (body.system) {
    if (typeof body.system === "string") {
      output.push({ role: "system", content: body.system });
    } else if (Array.isArray(body.system)) {
      const text = body.system
        .filter((item) => item && item.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n");
      if (text) output.push({ role: "system", content: text });
    }
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];

  for (const message of messages) {
    if (!message || !message.role) continue;

    output.push({
      role: message.role,
      content: anthropicBlocksToText(message.content),
    });
  }

  return output;
}

function mapFinishReasonToAnthropicStopReason(finishReason) {
  if (finishReason === "stop") return "end_turn";
  if (finishReason === "length") return "max_tokens";
  return "end_turn";
}

function toAnthropicResponse(openAIResponse, modelName) {
  const choice = openAIResponse?.choices?.[0] || {};
  const text = choice?.message?.content || choice?.message?.reasoning_content || "";
  const usage = openAIResponse?.usage || {};

  return {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: modelName,
    content: [{ type: "text", text }],
    stop_reason: mapFinishReasonToAnthropicStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
    },
  };
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

    const payload = {
      ...body,
      model: body.model || DEFAULT_MODEL,
      max_tokens: body.max_tokens || 512,
      reasoning_effort: body.reasoning_effort || "low",
    };

    const upstreamResponse = await requestWithContentRecovery(payload);
    res.status(200).json(upstreamResponse);
  } catch (error) {
    const status = error.status || 500;
    const message = error.payload || { error: error.message || "Unknown error" };
    res.status(status).json(message);
  }
});

app.post("/v1/messages", requireGatewayToken, async (req, res) => {
  try {
    const body = req.body || {};
    const modelName = body.model || DEFAULT_MODEL;

    const upstreamPayload = {
      model: modelName,
      messages: anthropicToOpenAIMessages(body),
      max_tokens: body.max_tokens || 512,
      temperature: body.temperature,
      top_p: body.top_p,
      stop: body.stop_sequences,
      reasoning_effort: body.reasoning_effort || "low",
      stream: false,
    };

    const upstreamResponse = await requestWithContentRecovery(upstreamPayload);
    const anthropicResponse = toAnthropicResponse(upstreamResponse, modelName);

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
