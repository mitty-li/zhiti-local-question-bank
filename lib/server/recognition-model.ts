import { callAntigravityGemini, type AntigravityResult } from "./antigravity-gemini";
import { recognitionReasoningEffort } from "./recognition-model-rules.mjs";

type UpstreamResult = AntigravityResult;
type RecognitionModelInput = { apiKey: string; prompt: string; image: string; schema: Record<string, unknown>; schemaName: string; signal?:AbortSignal };

function apiBase() {
  let base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  base = base.replace(/\/(responses|chat\/completions)$/i, "");
  if (!/\/v1$/i.test(base)) base += "/v1";
  return base;
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output as Array<{ content?: Array<{ type?: string; text?: string }> }> : [];
  return output.flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map(item=>item.text||" ").join("")||undefined;
}

async function callResponses(input: RecognitionModelInput): Promise<UpstreamResult> {
  const response = await fetch(`${apiBase()}/responses`, {
    signal:input.signal, method: "POST", headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_VISION_MODEL || "gemini-3.8-flash-high", store: false, reasoning: { effort: recognitionReasoningEffort() }, input: [{ role: "user", content: [{ type: "input_text", text: input.prompt }, { type: "input_image", image_url: input.image, detail: "high" }] }], text: { format: { type: "json_schema", name: input.schemaName, strict: true, schema: input.schema } } }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: { message?: string } };
  return { status: response.status, retryAfter: response.headers.get("retry-after"), text: response.ok ? outputText(payload) : undefined, error: payload.error?.message || (!response.ok ? `Responses 请求失败（${response.status}）` : undefined) };
}

async function callChatCompletions(input: RecognitionModelInput): Promise<UpstreamResult> {
  const response = await fetch(`${apiBase()}/chat/completions`, {
    signal:input.signal, method: "POST", headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_VISION_MODEL || "gemini-3.8-flash-high", reasoning_effort: recognitionReasoningEffort(), messages: [{ role: "user", content: [{ type: "text", text: input.prompt }, { type: "image_url", image_url: { url: input.image, detail: "high" } }] }], response_format: { type: "json_schema", json_schema: { name: input.schemaName, strict: true, schema: input.schema } } }),
  });
  const payload = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>; error?: { message?: string } };
  const content = payload.choices?.[0]?.message?.content;
  return { status: response.status, retryAfter: response.headers.get("retry-after"), text: response.ok ? typeof content === "string" ? content : content?.filter((item) => item.type === "text").map(item=>item.text||"").join("") : undefined, error: payload.error?.message || (!response.ok ? `Chat Completions 请求失败（${response.status}）` : undefined) };
}

// Endpoint capability, not response content. Scoped to endpoint/model/credential
// digest, bounded and expiring; no prompts, images, API keys or model output.
const chatEndpoints=new Map<string,number>();
const CAPABILITY_TTL=10*60_000;
async function capabilityKey(apiKey:string) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(apiKey));
  return `${apiBase()}|${process.env.OPENAI_VISION_MODEL||''}|${Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}`;
}
function responsesUnsupported(result:UpstreamResult) {
  return [404,405,501].includes(result.status)
    ||[400,422].includes(result.status)&&/(?:unsupported|not supported|does not support).*(?:responses|endpoint)|(?:responses|endpoint).*(?:unsupported|not supported)/i.test(result.error||'');
}
async function callConfiguredModel(input:RecognitionModelInput):Promise<UpstreamResult> {
  const mode=process.env.OPENAI_API_MODE||'auto';
  if(mode==='antigravity_gemini')return callAntigravityGemini(process.env.OPENAI_BASE_URL||'https://api.openai.com',input.apiKey,process.env.OPENAI_VISION_MODEL||'gemini-3.8-flash-high',input.prompt,[input.image],input.schema,recognitionReasoningEffort(),input.signal);
  if(mode==='chat_completions')return callChatCompletions(input);
  if(mode==='responses')return callResponses(input);
  const key=await capabilityKey(input.apiKey),until=chatEndpoints.get(key);
  if(until&&until>Date.now())return callChatCompletions(input);
  chatEndpoints.delete(key);
  const first=await callResponses(input);
  // Never hide authentication, rate limits, timeouts or schema/model failures
  // by silently making a second billed request through another protocol.
  if(!responsesUnsupported(first))return first;
  const fallback=await callChatCompletions(input);
  if(fallback.status<400&&fallback.text){
    if(chatEndpoints.size>=32)chatEndpoints.delete(chatEndpoints.keys().next().value!);
    chatEndpoints.set(key,Date.now()+CAPABILITY_TTL);
  }
  return fallback;
}
export async function callRecognitionModel(input:RecognitionModelInput):Promise<UpstreamResult> {
  const configured=Number(process.env.RECOGNITION_TIMEOUT_MS);
  const timeout=Number.isFinite(configured)&&configured>=1000?Math.min(600_000,configured):180_000;
  const deadline=AbortSignal.timeout(timeout);
  const signal=input.signal?AbortSignal.any([input.signal,deadline]):deadline;
  try {return await callConfiguredModel({...input,signal});}
  catch(error){
    if(deadline.aborted&&!input.signal?.aborted)return {status:504,retryAfter:null,error:`Recognition exceeded ${timeout/1000}s; completed pages are preserved`};
    throw error;
  }
}

export function parseRecognitionModelText(text: string) {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as unknown;
}
