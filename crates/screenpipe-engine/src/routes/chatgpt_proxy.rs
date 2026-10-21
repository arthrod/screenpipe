// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

//! `chatgpt/<model>` on the local `/v1/chat/completions` proxy: the answer
//! comes from the user's ChatGPT subscription instead of screenpipe cloud.
//! n8n workflows (and any OpenAI client on the machine) keep the same base URL
//! and local key; only the model name changes, e.g. `chatgpt/gpt-5.6-luna:max`.
//! The optional `:<effort>` suffix sets the reasoning effort (`low` … `max`),
//! for clients that cannot send it (n8n only passes low, medium or high); a
//! `reasoning_effort` in the request overrides it.
//!
//! The ChatGPT sign-in is the one the desktop app holds (Settings → AI →
//! ChatGPT), read and refreshed through screenpipe-core as pipes do. The
//! ChatGPT backend only speaks the Codex Responses API, streamed, so the
//! request is translated from Chat Completions, the stream is read to its end,
//! and the result is answered as one chat completion (or as a short stream
//! when the caller asked for `stream: true`). Sampling and length parameters
//! (`temperature`, `max_tokens`, …) are dropped: reasoning models do not take
//! them.

use axum::{
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine as _;
use serde_json::{json, Map, Value};
use tracing::warn;

/// Model names with this prefix are answered by ChatGPT.
const MODEL_PREFIX: &str = "chatgpt/";
const CODEX_URL: &str = "https://chatgpt.com/backend-api/codex/responses";
/// The backend requires instructions; used when the request has no system message.
const DEFAULT_INSTRUCTIONS: &str = "You are a helpful assistant.";

/// A `chatgpt/<name>[:<effort>]` model: the ChatGPT model and the reasoning
/// effort its suffix asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatGptModel {
    /// The model as the caller named it, echoed in the answer.
    id: String,
    name: String,
    effort: Option<String>,
}

impl ChatGptModel {
    fn parse(model: &str) -> Option<Self> {
        let rest = model.strip_prefix(MODEL_PREFIX)?;
        let (name, effort) = match rest.split_once(':') {
            Some((name, effort)) => (name, Some(effort).filter(|e| !e.is_empty())),
            None => (rest, None),
        };
        if name.is_empty() {
            return None;
        }
        Some(Self {
            id: model.to_string(),
            name: name.to_string(),
            effort: effort.map(str::to_string),
        })
    }
}

/// The ChatGPT model a chat request names, or `None` when the request is not
/// for ChatGPT.
pub fn requested_model(body: &[u8]) -> Option<ChatGptModel> {
    #[derive(serde::Deserialize)]
    struct Model {
        model: Option<String>,
    }
    ChatGptModel::parse(&serde_json::from_slice::<Model>(body).ok()?.model?)
}

/// Answers a Chat Completions request for `model` with the user's ChatGPT
/// subscription.
pub async fn chat_completions(model: ChatGptModel, body: axum::body::Bytes) -> Response {
    // Reads, and refreshes when expired, the token the app stored. Blocking.
    let token =
        tokio::task::spawn_blocking(screenpipe_core::pipes::read_chatgpt_oauth_token)
            .await
            .ok()
            .flatten();
    let Some(token) = token else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "chatgpt_not_connected",
            "connect ChatGPT in screenpipe (Settings → AI → ChatGPT) to use chatgpt/ models",
        );
    };
    let Some(auth) = ChatGptAuth::from_token(token) else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "chatgpt_not_connected",
            "this ChatGPT sign-in has no account id: sign out of ChatGPT in screenpipe and sign in again",
        );
    };
    chat_completions_with(&auth, &model, &body, CODEX_URL).await
}

/// The signed-in ChatGPT account: its access token and the account id the
/// backend wants in the `chatgpt-account-id` header.
struct ChatGptAuth {
    token: String,
    account_id: String,
}

impl ChatGptAuth {
    fn from_token(token: String) -> Option<Self> {
        let account_id = account_id(&token)?;
        Some(Self { token, account_id })
    }
}

/// The `chatgpt_account_id` claim of a ChatGPT access token (a JWT).
fn account_id(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    claims
        .get("https://api.openai.com/auth")?
        .get("chatgpt_account_id")?
        .as_str()
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

/// The proxy itself, with the upstream URL as a parameter so tests can point
/// it at a fake backend.
async fn chat_completions_with(
    auth: &ChatGptAuth,
    model: &ChatGptModel,
    body: &[u8],
    url: &str,
) -> Response {
    let request: Value = match serde_json::from_slice(body) {
        Ok(request) => request,
        Err(e) => {
            return error(
                StatusCode::BAD_REQUEST,
                "invalid_request",
                &format!("the request is not JSON: {e}"),
            )
        }
    };
    let upstream_body = match responses_request(&request, model) {
        Ok(upstream_body) => upstream_body,
        Err(message) => return error(StatusCode::BAD_REQUEST, "invalid_request", &message),
    };

    let response = match reqwest::Client::new()
        .post(url)
        .bearer_auth(&auth.token)
        .header("chatgpt-account-id", &auth.account_id)
        .header("OpenAI-Beta", "responses=experimental")
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .json(&upstream_body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => {
            warn!("chatgpt_proxy: upstream send failed: {}", e);
            return error(
                StatusCode::BAD_GATEWAY,
                "upstream_unreachable",
                &format!("cannot reach ChatGPT: {e}"),
            );
        }
    };
    let status = response.status();
    let text = match response.text().await {
        Ok(text) => text,
        Err(e) => {
            warn!("chatgpt_proxy: upstream body read failed: {}", e);
            return error(
                StatusCode::BAD_GATEWAY,
                "upstream_unreachable",
                &format!("the ChatGPT answer was cut: {e}"),
            );
        }
    };
    if !status.is_success() {
        let message = upstream_message(&text);
        warn!("chatgpt_proxy: ChatGPT answered {}: {}", status, message);
        return error(
            status,
            "chatgpt_error",
            &format!("ChatGPT answered HTTP {}: {message}", status.as_u16()),
        );
    }

    let answer = match read_stream(&text) {
        Ok(answer) => answer,
        Err((status, message)) => {
            warn!("chatgpt_proxy: ChatGPT failed: {}", message);
            return error(status, "chatgpt_error", &message);
        }
    };
    let completion = chat_completion(&answer, model);
    if request.get("stream") == Some(&Value::Bool(true)) {
        let include_usage =
            request.pointer("/stream_options/include_usage") == Some(&Value::Bool(true));
        return (
            [(header::CONTENT_TYPE, "text/event-stream")],
            chat_stream(&completion, include_usage),
        )
            .into_response();
    }
    Json(completion).into_response()
}

/// The Codex Responses request for a Chat Completions `request`.
fn responses_request(request: &Value, model: &ChatGptModel) -> Result<Value, String> {
    let messages = request
        .get("messages")
        .and_then(Value::as_array)
        .ok_or("`messages` must be an array")?;
    let mut instructions = Vec::new();
    let mut input = Vec::new();
    for (index, message) in messages.iter().enumerate() {
        let content = message.get("content");
        match message.get("role").and_then(Value::as_str).unwrap_or_default() {
            "system" | "developer" => instructions.push(text_of(content)?),
            "user" => input.push(json!({"role": "user", "content": user_content(content)?})),
            "assistant" => {
                let text = text_of(content)?;
                if !text.is_empty() {
                    input.push(json!({
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "id": format!("msg_{index}"),
                        "content": [{"type": "output_text", "text": text, "annotations": []}],
                    }));
                }
                let calls = message.get("tool_calls").and_then(Value::as_array);
                for call in calls.into_iter().flatten() {
                    input.push(json!({
                        "type": "function_call",
                        "call_id": str_at(call, "/id"),
                        "name": str_at(call, "/function/name"),
                        "arguments": call
                            .pointer("/function/arguments")
                            .and_then(Value::as_str)
                            .unwrap_or("{}"),
                    }));
                }
            }
            "tool" => input.push(json!({
                "type": "function_call_output",
                "call_id": str_at(message, "/tool_call_id"),
                "output": text_of(content)?,
            })),
            other => return Err(format!("unsupported message role `{other}`")),
        }
    }

    let instructions = if instructions.is_empty() {
        DEFAULT_INSTRUCTIONS.to_string()
    } else {
        instructions.join("\n\n")
    };
    let mut body = json!({
        "model": model.name,
        "instructions": instructions,
        "input": input,
        "store": false,
        "stream": true,
    });
    if let Some(tools) = request.get("tools").and_then(Value::as_array) {
        let tools = tools.iter().map(function_tool).collect::<Result<Vec<_>, _>>()?;
        body["tools"] = tools.into();
    }
    match request.get("tool_choice") {
        Some(Value::String(choice)) => body["tool_choice"] = choice.as_str().into(),
        Some(choice) => {
            if let Some(name) = choice.pointer("/function/name") {
                body["tool_choice"] = json!({"type": "function", "name": name});
            }
        }
        None => {}
    }
    if let Some(parallel) = request.get("parallel_tool_calls").filter(|p| p.is_boolean()) {
        body["parallel_tool_calls"] = parallel.clone();
    }
    if let Some(format) = text_format(request.get("response_format")) {
        body["text"] = json!({ "format": format });
    }
    let effort = request.get("reasoning_effort").and_then(Value::as_str);
    if let Some(effort) = effort.or(model.effort.as_deref()) {
        body["reasoning"] = json!({ "effort": effort });
    }
    Ok(body)
}

/// The text of a system, assistant or tool message: a string, or the text
/// parts of an array.
fn text_of(content: Option<&Value>) -> Result<String, String> {
    match content {
        None | Some(Value::Null) => Ok(String::new()),
        Some(Value::String(text)) => Ok(text.clone()),
        Some(Value::Array(parts)) => parts
            .iter()
            .map(|part| match part.get("type").and_then(Value::as_str) {
                Some("text") => Ok(str_at(part, "/text").to_string()),
                other => Err(format!(
                    "only user messages can hold `{}` parts",
                    other.unwrap_or("untyped")
                )),
            })
            .collect(),
        Some(_) => Err("message `content` must be a string or an array".to_string()),
    }
}

/// A user message's content as Responses input parts: text and images.
fn user_content(content: Option<&Value>) -> Result<Value, String> {
    let parts = match content {
        Some(Value::Array(parts)) => parts.as_slice(),
        other => return Ok(json!([{"type": "input_text", "text": text_of(other)?}])),
    };
    parts
        .iter()
        .map(|part| match part.get("type").and_then(Value::as_str) {
            Some("text") => Ok(json!({"type": "input_text", "text": str_at(part, "/text")})),
            Some("image_url") => Ok(json!({
                "type": "input_image",
                "image_url": str_at(part, "/image_url/url"),
                "detail": part.pointer("/image_url/detail").and_then(Value::as_str).unwrap_or("auto"),
            })),
            other => Err(format!(
                "unsupported content part `{}`",
                other.unwrap_or("untyped")
            )),
        })
        .collect()
}

/// A Chat Completions function tool as a Responses function tool. `strict`
/// stays off unless the caller asked for it, as in Chat Completions.
fn function_tool(tool: &Value) -> Result<Value, String> {
    if tool.get("type").and_then(Value::as_str) != Some("function") {
        return Err("only function tools are supported".to_string());
    }
    let function = tool.get("function").ok_or("a tool has no `function`")?;
    let mut out = Map::new();
    out.insert("type".into(), "function".into());
    out.insert("name".into(), str_at(function, "/name").into());
    if let Some(description) = function.get("description") {
        out.insert("description".into(), description.clone());
    }
    let parameters = function
        .get("parameters")
        .cloned()
        .unwrap_or_else(|| json!({"type": "object", "properties": {}}));
    out.insert("parameters".into(), parameters);
    let strict = function.get("strict").and_then(Value::as_bool).unwrap_or(false);
    out.insert("strict".into(), strict.into());
    Ok(Value::Object(out))
}

/// `response_format` as a Responses `text.format`.
fn text_format(response_format: Option<&Value>) -> Option<Value> {
    let response_format = response_format?;
    match response_format.get("type").and_then(Value::as_str)? {
        "json_object" => Some(json!({"type": "json_object"})),
        "json_schema" => {
            let schema = response_format.get("json_schema")?;
            let mut format = json!({
                "type": "json_schema",
                "name": schema.get("name").and_then(Value::as_str).unwrap_or("response"),
                "schema": schema.get("schema").cloned().unwrap_or_else(|| json!({})),
            });
            for key in ["strict", "description"] {
                if let Some(value) = schema.get(key) {
                    format[key] = value.clone();
                }
            }
            Some(format)
        }
        _ => None,
    }
}

/// What the Codex stream said, read to its end: the finished output items and
/// the final response (status, usage).
struct Answer {
    items: Vec<Value>,
    response: Value,
}

/// Reads a Codex Responses event stream. Items come from
/// `response.output_item.done` events; the final response's `output` is only
/// a fallback, since the backend may leave it empty.
fn read_stream(sse: &str) -> Result<Answer, (StatusCode, String)> {
    let mut items = Vec::new();
    for data in sse.lines().filter_map(|line| line.strip_prefix("data:")) {
        let Ok(event) = serde_json::from_str::<Value>(data.trim()) else {
            continue;
        };
        match event.get("type").and_then(Value::as_str).unwrap_or_default() {
            "response.output_item.done" => items.extend(event.get("item").cloned()),
            "response.completed" | "response.done" | "response.incomplete" => {
                let response = event.get("response").cloned().unwrap_or(Value::Null);
                if items.is_empty() {
                    if let Some(output) = response.get("output").and_then(Value::as_array) {
                        items = output.clone();
                    }
                }
                return Ok(Answer { items, response });
            }
            "response.failed" => return Err(failure(event.pointer("/response/error"))),
            "error" => return Err(failure(event.get("error").or(Some(&event)))),
            _ => {}
        }
    }
    Err((
        StatusCode::BAD_GATEWAY,
        "the ChatGPT answer ended before it was complete".to_string(),
    ))
}

/// The status and message for a failure reported inside the stream. Usage
/// limits are a 429, so callers can tell them from a broken answer.
fn failure(error: Option<&Value>) -> (StatusCode, String) {
    let code = error.and_then(|e| e.get("code")).and_then(Value::as_str);
    let message = error
        .and_then(|e| e.get("message"))
        .and_then(Value::as_str)
        .or(code)
        .unwrap_or("ChatGPT failed without a reason");
    let status = match code {
        Some(code) if code.contains("usage_limit") || code.contains("rate_limit") => {
            StatusCode::TOO_MANY_REQUESTS
        }
        _ => StatusCode::BAD_GATEWAY,
    };
    (status, format!("ChatGPT failed: {message}"))
}

/// The answer as a Chat Completions response.
fn chat_completion(answer: &Answer, model: &ChatGptModel) -> Value {
    let mut text = String::new();
    let mut tool_calls = Vec::new();
    for item in &answer.items {
        match item.get("type").and_then(Value::as_str) {
            Some("message") => {
                let parts = item.get("content").and_then(Value::as_array);
                for part in parts.into_iter().flatten() {
                    match part.get("type").and_then(Value::as_str) {
                        Some("output_text") => text.push_str(str_at(part, "/text")),
                        Some("refusal") => text.push_str(str_at(part, "/refusal")),
                        _ => {}
                    }
                }
            }
            Some("function_call") => tool_calls.push(json!({
                "id": str_at(item, "/call_id"),
                "type": "function",
                "function": {"name": str_at(item, "/name"), "arguments": str_at(item, "/arguments")},
            })),
            // Reasoning items have no Chat Completions counterpart.
            _ => {}
        }
    }

    let incomplete = answer
        .response
        .pointer("/incomplete_details/reason")
        .and_then(Value::as_str);
    let finish_reason = if !tool_calls.is_empty() {
        "tool_calls"
    } else if incomplete == Some("max_output_tokens") {
        "length"
    } else if incomplete == Some("content_filter") {
        "content_filter"
    } else {
        "stop"
    };
    let mut message = json!({"role": "assistant", "content": text});
    if !tool_calls.is_empty() {
        if text.is_empty() {
            message["content"] = Value::Null;
        }
        message["tool_calls"] = tool_calls.into();
    }
    let created = answer
        .response
        .get("created_at")
        .and_then(Value::as_i64)
        .unwrap_or_else(|| chrono::Utc::now().timestamp());
    let tokens = |key: &str| answer.response.pointer(&format!("/usage/{key}")).cloned().unwrap_or(0.into());
    json!({
        "id": format!("chatcmpl-{}", uuid::Uuid::new_v4().simple()),
        "object": "chat.completion",
        "created": created,
        "model": model.id,
        "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}],
        "usage": {
            "prompt_tokens": tokens("input_tokens"),
            "completion_tokens": tokens("output_tokens"),
            "total_tokens": tokens("total_tokens"),
        },
    })
}

/// The completion as a Chat Completions stream: one chunk with the whole
/// answer, one with the finish reason, a usage chunk when asked, then `[DONE]`.
fn chat_stream(completion: &Value, include_usage: bool) -> String {
    let chunk = |choices: Value| {
        json!({
            "id": completion["id"],
            "object": "chat.completion.chunk",
            "created": completion["created"],
            "model": completion["model"],
            "choices": choices,
        })
    };
    let message = &completion["choices"][0]["message"];
    let mut delta = json!({"role": "assistant", "content": message["content"]});
    if let Some(calls) = message.get("tool_calls").and_then(Value::as_array) {
        let calls: Vec<Value> = calls
            .iter()
            .enumerate()
            .map(|(index, call)| {
                let mut call = call.clone();
                call["index"] = index.into();
                call
            })
            .collect();
        delta["tool_calls"] = calls.into();
    }
    let finish_reason = &completion["choices"][0]["finish_reason"];
    let mut events = vec![
        chunk(json!([{"index": 0, "delta": delta, "finish_reason": null}])),
        chunk(json!([{"index": 0, "delta": {}, "finish_reason": finish_reason}])),
    ];
    if include_usage {
        let mut usage = chunk(json!([]));
        usage["usage"] = completion["usage"].clone();
        events.push(usage);
    }
    let mut stream: String = events.iter().map(|event| format!("data: {event}\n\n")).collect();
    stream.push_str("data: [DONE]\n\n");
    stream
}

/// The readable reason in a ChatGPT error body, or the body itself, clipped.
fn upstream_message(body: &str) -> String {
    let json: Option<Value> = serde_json::from_str(body).ok();
    let found = json.as_ref().and_then(|json| {
        ["/error/message", "/detail/message", "/detail", "/message"]
            .iter()
            .find_map(|pointer| json.pointer(pointer).and_then(Value::as_str))
    });
    let message = found.unwrap_or(body).trim();
    match message.char_indices().nth(300) {
        Some((cut, _)) => format!("{}…", &message[..cut]),
        None => message.to_string(),
    }
}

/// An OpenAI-shaped error, which OpenAI clients (n8n) show as is.
fn error(status: StatusCode, code: &str, message: &str) -> Response {
    let body = json!({"error": {"message": message, "type": code, "code": code}});
    (status, Json(body)).into_response()
}

/// The string at `pointer`, or "" when it is missing or not a string.
fn str_at<'a>(value: &'a Value, pointer: &str) -> &'a str {
    value.pointer(pointer).and_then(Value::as_str).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use wiremock::matchers::{body_partial_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const ACCOUNT: &str = "acct-123";

    /// An unsigned JWT whose payload carries `claims`; only the payload is read.
    fn jwt(claims: Value) -> String {
        let encode = |v: &Value| {
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.to_string())
        };
        format!("{}.{}.sig", encode(&json!({"alg": "none"})), encode(&claims))
    }

    fn auth() -> ChatGptAuth {
        let token = jwt(json!({"https://api.openai.com/auth": {"chatgpt_account_id": ACCOUNT}}));
        ChatGptAuth::from_token(token).unwrap()
    }

    /// The SSE body the Codex backend streams for these events.
    fn sse(events: &[Value]) -> String {
        events
            .iter()
            .map(|event| format!("event: {}\ndata: {event}\n\n", event["type"].as_str().unwrap()))
            .collect()
    }

    fn completed(usage: Value) -> Value {
        json!({"type": "response.completed", "response": {
            "id": "resp_1", "status": "completed", "created_at": 1_700_000_000, "output": [], "usage": usage,
        }})
    }

    fn text_answer(text: &str) -> String {
        sse(&[
            json!({"type": "response.created", "response": {"id": "resp_1"}}),
            json!({"type": "response.output_item.done", "item": {"type": "reasoning", "summary": []}}),
            json!({"type": "response.output_text.delta", "delta": text}),
            json!({"type": "response.output_item.done", "item": {
                "type": "message", "role": "assistant",
                "content": [{"type": "output_text", "text": text, "annotations": []}],
            }}),
            completed(json!({"input_tokens": 12, "output_tokens": 3, "total_tokens": 15})),
        ])
    }

    /// Fake ChatGPT backend answering the Codex endpoint with `upstream`.
    async fn fake_chatgpt(upstream: ResponseTemplate) -> MockServer {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/backend-api/codex/responses"))
            .and(header("authorization", format!("Bearer {}", auth().token).as_str()))
            .and(header("chatgpt-account-id", ACCOUNT))
            .and(body_partial_json(json!({"store": false, "stream": true})))
            .respond_with(upstream)
            .mount(&server)
            .await;
        server
    }

    fn model(id: &str) -> ChatGptModel {
        ChatGptModel::parse(id).unwrap()
    }

    async fn proxy(server: &MockServer, request: Value) -> (StatusCode, String, Vec<u8>) {
        let url = format!("{}/backend-api/codex/responses", server.uri());
        let body = serde_json::to_vec(&request).unwrap();
        let response =
            chat_completions_with(&auth(), &model("chatgpt/gpt-5.6-terra"), &body, &url).await;
        let status = response.status();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .map(|ct| ct.to_str().unwrap().to_string())
            .unwrap_or_default();
        let body = to_bytes(response.into_body(), 1 << 20).await.unwrap();
        (status, content_type, body.to_vec())
    }

    fn json_of(body: &[u8]) -> Value {
        serde_json::from_slice(body).unwrap()
    }

    #[test]
    fn only_chatgpt_prefixed_models_are_for_chatgpt() {
        let requested = |m: &str| requested_model(json!({"model": m, "messages": []}).to_string().as_bytes());
        let terra = requested("chatgpt/gpt-5.6-terra").unwrap();
        assert_eq!((terra.name.as_str(), terra.effort), ("gpt-5.6-terra", None));
        assert_eq!(requested("auto"), None);
        assert_eq!(requested("gpt-5.6-sol"), None);
        assert_eq!(requested("chatgpt/"), None);
        assert_eq!(requested("chatgpt/:max"), None);
        assert_eq!(requested_model(b"not json"), None);
        assert_eq!(requested_model(b"{\"messages\": []}"), None);
    }

    #[test]
    fn an_effort_suffix_sets_the_reasoning_effort() {
        let luna = model("chatgpt/gpt-5.6-luna:max");
        assert_eq!((luna.name.as_str(), luna.effort.as_deref()), ("gpt-5.6-luna", Some("max")));
        assert_eq!(model("chatgpt/gpt-5.6-luna:").effort, None);

        let request = json!({"messages": [{"role": "user", "content": "hi"}]});
        let body = responses_request(&request, &luna).unwrap();
        assert_eq!(body["model"], "gpt-5.6-luna");
        assert_eq!(body["reasoning"], json!({"effort": "max"}));

        // An effort the request names wins over the suffix.
        let request = json!({"reasoning_effort": "low", "messages": [{"role": "user", "content": "hi"}]});
        assert_eq!(responses_request(&request, &luna).unwrap()["reasoning"], json!({"effort": "low"}));

        // No suffix and no request effort: the backend's default.
        let plain = json!({"messages": [{"role": "user", "content": "hi"}]});
        assert!(responses_request(&plain, &model("chatgpt/gpt-5.6-luna")).unwrap().get("reasoning").is_none());
    }

    #[test]
    fn the_account_id_comes_from_the_token_claims() {
        assert_eq!(auth().account_id, ACCOUNT);
        assert!(ChatGptAuth::from_token(jwt(json!({"sub": "user"}))).is_none());
        assert!(ChatGptAuth::from_token("not-a-jwt".to_string()).is_none());
    }

    #[test]
    fn a_tool_conversation_becomes_a_responses_request() {
        let request = json!({
            "model": "chatgpt/gpt-5.6-terra",
            "temperature": 0.2,
            "max_tokens": 100,
            "reasoning_effort": "low",
            "messages": [
                {"role": "system", "content": "Classify emails."},
                {"role": "system", "content": [{"type": "text", "text": "Answer in JSON."}]},
                {"role": "user", "content": [
                    {"type": "text", "text": "Is this a bug?"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}},
                ]},
                {"role": "assistant", "content": null, "tool_calls": [
                    {"id": "call_1", "type": "function", "function": {"name": "search", "arguments": "{\"q\":\"jira\"}"}},
                ]},
                {"role": "tool", "tool_call_id": "call_1", "content": "NOVA-12 created by hand"},
                {"role": "assistant", "content": "Looking."},
            ],
            "tools": [{"type": "function", "function": {
                "name": "search", "description": "Search ScreenPipe",
                "parameters": {"type": "object", "properties": {"q": {"type": "string"}}},
            }}],
            "tool_choice": {"type": "function", "function": {"name": "search"}},
            "response_format": {"type": "json_schema", "json_schema": {"name": "ticket", "schema": {"type": "object"}, "strict": true}},
        });

        let body = responses_request(&request, &model("chatgpt/gpt-5.6-terra")).unwrap();

        assert_eq!(body, json!({
            "model": "gpt-5.6-terra",
            "instructions": "Classify emails.\n\nAnswer in JSON.",
            "input": [
                {"role": "user", "content": [
                    {"type": "input_text", "text": "Is this a bug?"},
                    {"type": "input_image", "image_url": "data:image/png;base64,AAA", "detail": "auto"},
                ]},
                {"type": "function_call", "call_id": "call_1", "name": "search", "arguments": "{\"q\":\"jira\"}"},
                {"type": "function_call_output", "call_id": "call_1", "output": "NOVA-12 created by hand"},
                {"type": "message", "role": "assistant", "status": "completed", "id": "msg_5",
                 "content": [{"type": "output_text", "text": "Looking.", "annotations": []}]},
            ],
            "store": false,
            "stream": true,
            "tools": [{"type": "function", "name": "search", "description": "Search ScreenPipe",
                       "parameters": {"type": "object", "properties": {"q": {"type": "string"}}}, "strict": false}],
            "tool_choice": {"type": "function", "name": "search"},
            "text": {"format": {"type": "json_schema", "name": "ticket", "schema": {"type": "object"}, "strict": true}},
            "reasoning": {"effort": "low"},
        }));
    }

    #[test]
    fn a_request_without_system_message_gets_default_instructions() {
        let request = json!({"messages": [{"role": "user", "content": "hi"}]});
        let body = responses_request(&request, &model("chatgpt/gpt-5.6-terra")).unwrap();
        assert_eq!(body["instructions"], DEFAULT_INSTRUCTIONS);
        assert_eq!(body["input"], json!([{"role": "user", "content": [{"type": "input_text", "text": "hi"}]}]));
    }

    #[test]
    fn unsupported_content_is_refused_by_name() {
        let audio = json!({"messages": [{"role": "user", "content": [{"type": "input_audio"}]}]});
        assert!(responses_request(&audio, &model("chatgpt/m")).unwrap_err().contains("input_audio"));
        let role = json!({"messages": [{"role": "function", "content": "x"}]});
        assert!(responses_request(&role, &model("chatgpt/m")).unwrap_err().contains("function"));
        let tool = json!({"messages": [], "tools": [{"type": "web_search"}]});
        assert!(responses_request(&tool, &model("chatgpt/m")).is_err());
    }

    #[tokio::test]
    async fn a_text_answer_becomes_a_chat_completion() {
        let server = fake_chatgpt(
            ResponseTemplate::new(200).set_body_raw(text_answer("Bug"), "text/event-stream"),
        )
        .await;

        let (status, content_type, body) = proxy(
            &server,
            json!({"model": "chatgpt/gpt-5.6-terra", "messages": [{"role": "user", "content": "Bug or not?"}]}),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(content_type, "application/json");
        let body = json_of(&body);
        assert_eq!(body["object"], "chat.completion");
        assert_eq!(body["model"], "chatgpt/gpt-5.6-terra");
        assert_eq!(body["created"], 1_700_000_000);
        assert_eq!(body["choices"][0]["message"], json!({"role": "assistant", "content": "Bug"}));
        assert_eq!(body["choices"][0]["finish_reason"], "stop");
        assert_eq!(body["usage"], json!({"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15}));
    }

    #[tokio::test]
    async fn a_function_call_becomes_an_openai_tool_call() {
        let server = fake_chatgpt(ResponseTemplate::new(200).set_body_raw(
            sse(&[
                json!({"type": "response.output_item.done", "item": {
                    "type": "function_call", "id": "fc_1", "call_id": "call_abc",
                    "name": "search", "arguments": "{\"q\":\"NOVA\"}",
                }}),
                completed(json!({"input_tokens": 1, "output_tokens": 1, "total_tokens": 2})),
            ]),
            "text/event-stream",
        ))
        .await;

        let (_, _, body) = proxy(&server, json!({"messages": [{"role": "user", "content": "find"}]})).await;

        let body = json_of(&body);
        assert_eq!(body["choices"][0]["finish_reason"], "tool_calls");
        assert_eq!(body["choices"][0]["message"], json!({
            "role": "assistant",
            "content": null,
            "tool_calls": [{"id": "call_abc", "type": "function",
                            "function": {"name": "search", "arguments": "{\"q\":\"NOVA\"}"}}],
        }));
    }

    #[tokio::test]
    async fn the_final_output_is_used_when_no_item_was_streamed() {
        let mut done = completed(json!({}));
        done["response"]["output"] = json!([{"type": "message", "content": [{"type": "output_text", "text": "OK"}]}]);
        let server = fake_chatgpt(
            ResponseTemplate::new(200).set_body_raw(sse(&[done]), "text/event-stream"),
        )
        .await;

        let (_, _, body) = proxy(&server, json!({"messages": [{"role": "user", "content": "hi"}]})).await;

        assert_eq!(json_of(&body)["choices"][0]["message"]["content"], "OK");
    }

    #[tokio::test]
    async fn a_streaming_caller_gets_chat_chunks_and_done() {
        let server = fake_chatgpt(
            ResponseTemplate::new(200).set_body_raw(text_answer("Bug"), "text/event-stream"),
        )
        .await;

        let (status, content_type, body) = proxy(
            &server,
            json!({"stream": true, "stream_options": {"include_usage": true},
                   "messages": [{"role": "user", "content": "Bug or not?"}]}),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(content_type, "text/event-stream");
        let text = String::from_utf8(body).unwrap();
        assert!(text.ends_with("data: [DONE]\n\n"), "{text}");
        let chunks: Vec<Value> = text
            .split("\n\n")
            .filter_map(|event| event.strip_prefix("data: "))
            .filter(|data| *data != "[DONE]")
            .map(|data| serde_json::from_str(data).unwrap())
            .collect();
        assert_eq!(chunks.len(), 3);
        assert!(chunks.iter().all(|c| c["object"] == "chat.completion.chunk"));
        assert_eq!(chunks[0]["choices"][0]["delta"], json!({"role": "assistant", "content": "Bug"}));
        assert_eq!(chunks[1]["choices"][0]["finish_reason"], "stop");
        assert_eq!(chunks[2]["usage"]["total_tokens"], 15);
    }

    #[tokio::test]
    async fn an_upstream_error_keeps_its_status_and_reason() {
        let server = fake_chatgpt(ResponseTemplate::new(429).set_body_json(json!({
            "error": {"type": "usage_limit_reached", "message": "The usage limit has been reached"},
        })))
        .await;

        let (status, _, body) = proxy(&server, json!({"messages": [{"role": "user", "content": "hi"}]})).await;

        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        let message = json_of(&body)["error"]["message"].as_str().unwrap().to_string();
        assert!(message.contains("HTTP 429") && message.contains("usage limit"), "{message}");
    }

    #[tokio::test]
    async fn a_failure_inside_the_stream_is_an_error_not_an_empty_answer() {
        let server = fake_chatgpt(ResponseTemplate::new(200).set_body_raw(
            sse(&[json!({"type": "response.failed", "response": {
                "error": {"code": "server_error", "message": "something broke"},
            }})]),
            "text/event-stream",
        ))
        .await;

        let (status, _, body) = proxy(&server, json!({"messages": [{"role": "user", "content": "hi"}]})).await;

        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(json_of(&body)["error"]["message"], "ChatGPT failed: something broke");
    }

    #[tokio::test]
    async fn a_usage_limit_inside_the_stream_is_a_429() {
        let server = fake_chatgpt(ResponseTemplate::new(200).set_body_raw(
            sse(&[json!({"type": "error", "error": {"code": "usage_limit_reached", "message": "limit"}})]),
            "text/event-stream",
        ))
        .await;

        let (status, _, _) = proxy(&server, json!({"messages": [{"role": "user", "content": "hi"}]})).await;

        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn a_cut_stream_is_an_error() {
        let server = fake_chatgpt(ResponseTemplate::new(200).set_body_raw(
            sse(&[json!({"type": "response.output_text.delta", "delta": "Bu"})]),
            "text/event-stream",
        ))
        .await;

        let (status, _, _) = proxy(&server, json!({"messages": [{"role": "user", "content": "hi"}]})).await;

        assert_eq!(status, StatusCode::BAD_GATEWAY);
    }

    #[tokio::test]
    async fn a_bad_request_never_reaches_chatgpt() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).respond_with(ResponseTemplate::new(200)).expect(0).mount(&server).await;

        let (status, _, body) = proxy(&server, json!({"messages": "hi"})).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json_of(&body)["error"]["code"], "invalid_request");
    }
}
