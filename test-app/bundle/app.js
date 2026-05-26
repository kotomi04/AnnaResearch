"use strict";

const TOOL_ID = "tool-test-llm-sampling-12345678";

const promptEl = document.getElementById("prompt");
const appCompleteBtn = document.getElementById("app-complete");
const appAgentBtn = document.getElementById("app-agent");
const toolSamplingBtn = document.getElementById("tool-sampling");
const toolAgentBtn = document.getElementById("tool-agent");
const outputEl = document.getElementById("output");
const statusEl = document.getElementById("status");
const connectionEl = document.getElementById("connection");

let anna = null;
let activeAgentSession = null;

async function init() {
  try {
    if (!window.AnnaAppRuntime) throw new Error("AnnaAppRuntime SDK not loaded");
    anna = await window.AnnaAppRuntime.connect();
    window.anna = anna;
    setConnection("Connected", true);
    setButtonsEnabled(true);
  } catch (err) {
    console.warn("[llm-agent-test] standalone mode:", err?.message || err);
    setConnection("Standalone", false);
    setButtonsEnabled(false);
  }
}

async function runAppComplete() {
  const prompt = getPrompt();
  if (!prompt) return;
  await runAction("Calling app anna.llm.complete...", async () => {
    const result = await anna.llm.complete({
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
      maxTokens: 512,
    });
    return { surface: "app.llm.complete", result };
  });
}

async function runAppAgent() {
  const prompt = getPrompt();
  if (!prompt) return;
  await runAction("Calling app anna.agent.session...", async () => {
    const session = await anna.agent.session({ submode: "auto" });
    activeAgentSession = session;
    const frames = [];
    let text = "";
    try {
      const stream = session.run({ content: prompt });
      for await (const frame of stream) {
        frames.push(frame);
        if ((frame.event === "token" || frame.event === "delta") && frame.text) {
          text += frame.text;
        } else if ((frame.event === "complete" || frame.event === "final") && frame.text) {
          text = frame.text;
        }
      }
      return {
        surface: "app.agent.session",
        appSessionUuid: session.appSessionUuid || session.app_session_uuid || null,
        text,
        frames,
      };
    } finally {
      try {
        await session.delete();
      } catch {
        /* best effort */
      }
      activeAgentSession = null;
    }
  });
}

async function runToolSampling() {
  const prompt = getPrompt();
  if (!prompt) return;
  await runAction("Calling tool sampling/createMessage...", async () => {
    const result = await anna.tools.invoke({
      tool_id: TOOL_ID,
      method: "complete",
      args: { prompt },
    });
    return { surface: "tool.sampling", result };
  });
}

async function runToolAgent() {
  const prompt = getPrompt();
  if (!prompt) return;
  await runAction("Calling tool agent/session.*...", async () => {
    const result = await anna.tools.invoke({
      tool_id: TOOL_ID,
      method: "agent_session",
      args: { prompt },
    });
    return { surface: "tool.agent.session", result };
  });
}

async function runAction(status, fn) {
  if (!anna) {
    setStatus("Anna runtime 未连接。", true);
    return;
  }
  setButtonsEnabled(false);
  setStatus(status, false);
  outputEl.textContent = "等待 Anna host 返回...";
  try {
    const result = await fn();
    setStatus("Done", false);
    outputEl.textContent = JSON.stringify(result, null, 2);
  } catch (err) {
    setStatus("Failed", true);
    outputEl.textContent = errorText(err);
  } finally {
    setButtonsEnabled(true);
  }
}

function getPrompt() {
  const prompt = promptEl.value.trim();
  if (!prompt) {
    setStatus("请输入内容。", true);
    return "";
  }
  return prompt;
}

function setButtonsEnabled(enabled) {
  for (const btn of [appCompleteBtn, appAgentBtn, toolSamplingBtn, toolAgentBtn]) {
    btn.disabled = !enabled;
  }
}

function setConnection(label, connected) {
  connectionEl.textContent = label;
  connectionEl.dataset.connected = connected ? "true" : "false";
}

function setStatus(label, isError) {
  statusEl.textContent = label;
  statusEl.dataset.error = isError ? "true" : "false";
}

function errorText(err) {
  return JSON.stringify({
    code: err?.code || err?.error?.code,
    message: err?.message || err?.error?.message || String(err),
    raw: err,
  }, null, 2);
}

appCompleteBtn.addEventListener("click", runAppComplete);
appAgentBtn.addEventListener("click", runAppAgent);
toolSamplingBtn.addEventListener("click", runToolSampling);
toolAgentBtn.addEventListener("click", runToolAgent);
window.addEventListener("beforeunload", () => {
  if (activeAgentSession) activeAgentSession.delete().catch(() => {});
});
document.addEventListener("DOMContentLoaded", init);
