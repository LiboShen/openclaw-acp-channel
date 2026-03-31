# Why this exists instead of using built-in `openclaw acp`

## Short answer

`openclaw acp` and this project solve **different integration problems**.

- **Built-in `openclaw acp`** is a Gateway-backed ACP bridge.
- **`openclaw-acp-channel`** is a **channel-based ACP bridge** for chat-style apps that need OpenClaw to behave like a messaging backend.

We built this because the built-in bridge was not a good fit for the target architecture, and in testing it was also not reliable enough for the required end-to-end chat workflow.

## Product requirement

The target app is a **chat UI** (Telegram-style / messaging-style), not an IDE.

Requirements included:

- keep an existing ACP STDIO client interface
- connect that ACP client to OpenClaw
- support **bidirectional messaging**
- support **agent-initiated messages**
- map multiple users / conversations cleanly
- behave like a channel integration instead of an IDE request/response shim
- verify the full real user path, not just theory

That is why the integration was built on top of **OpenClaw Channels**, not only on top of the Gateway ACP bridge.

## Architectural reason

### Built-in `openclaw acp`

Built-in ACP is designed as:

```text
ACP client
  ↕ stdio
openclaw acp
  ↕ gateway
OpenClaw session
```

This is useful for editor/tooling integrations.

### `openclaw-acp-channel`

This project is designed as:

```text
ACP client
  ↕ stdio
ACP bridge
  ↕ webhook
OpenClaw channel plugin
  ↕ runtime dispatch
OpenClaw agent
```

This is useful for **messaging/chat surfaces**.

The key distinction is that **channels are the right OpenClaw abstraction for chat apps**:

- user identity
- conversation identity
- inbound/outbound delivery
- future group/multi-user support
- agent-initiated replies
- media support
- normal channel lifecycle semantics

## Why built-in ACP was not enough

### 1. Wrong abstraction for the target app

The built-in ACP bridge is primarily a **Gateway request/response bridge**.

For a chat app, we needed something that behaves like a **channel transport**.

That matters because chat apps care about:

- who sent the message
- which conversation/session it belongs to
- how replies are pushed back
- whether the agent can initiate outbound delivery
- whether this can scale to multiple concurrent conversations cleanly

Channels already model that. Gateway ACP does not model it as naturally.

### 2. Agent-initiated / chat-style delivery was a requirement

The project requirement was not just “send prompt, get answer”.

It needed the bridge to fit a model where OpenClaw can send replies back through a chat transport path. A channel plugin gives a natural place to handle:

- inbound webhook from the app/bridge into OpenClaw
- outbound reply callback from OpenClaw back to the bridge/app

### 3. The original existing app already spoke ACP over STDIO

The goal was to preserve the caller-side ACP interface while adapting OpenClaw to a chat-oriented environment.

This plugin lets the app keep ACP on its side while using OpenClaw’s channel model underneath.

## Practical testing result

Beyond architecture, we also tested the built-in bridge directly.

## Manual verification of built-in `openclaw acp`

On the testbed, built-in `openclaw acp` was manually exercised over STDIO.

What worked:

- `initialize` ✅
- `session/new` ✅
- `session/load` ✅

What did **not** work reliably in our testing:

- `session/prompt` ❌ did not produce a usable end-to-end prompt/response flow in the tested environment

We also tested `openclaw acp client`, and it likewise did not provide a dependable prompt/response path for our needs.

At the same time, control tests showed:

- the gateway itself worked
- direct `openclaw agent` execution worked

So the failure appeared to be in the built-in ACP bridge/prompt delivery path rather than the underlying model/gateway itself.

## Public evidence / ecosystem signal

Research also found public evidence that built-in OpenClaw ACP has had reliability issues in nearby areas.

Notable example:

- **openclaw/openclaw#34863**
  - `openclaw acp client` returns only `[end_turn]` with no assistant content

This is not identical to our exact repro, but it is in the same problem family: built-in ACP session setup works, but prompt/result delivery is unreliable.

Meanwhile, the `acpx` project explicitly lists:

- `openclaw -> openclaw acp`

So the support is intentional, but public evidence suggests this path still has rough edges.

## Why the custom channel bridge is still the right solution

Even if built-in `openclaw acp` becomes fully reliable, this project still has value because it solves a different problem:

- adapting ACP clients to **channel semantics**
- fitting OpenClaw into a **chat/messaging** architecture
- enabling request-scoped callback delivery
- isolating sessions per conversation/user
- preserving the app’s ACP interface while using OpenClaw as a channel backend

In other words:

- built-in ACP is a good fit for **IDE-style ACP access to OpenClaw**
- this plugin is a better fit for **chat-app ACP access to OpenClaw**

## Decision summary

We built `openclaw-acp-channel` because:

1. the target product is a **chat app**, not an IDE
2. **Channels** are the correct OpenClaw abstraction for chat apps
3. the integration required **bidirectional, chat-style delivery**
4. the caller already spoke **ACP over STDIO**
5. the built-in `openclaw acp` path did not test out as a dependable end-to-end solution for this use case

## Bottom line

This project is not just a duplicate of `openclaw acp`.

It is a **channel-oriented ACP bridge** designed for messaging/chat integrations, and it exists because that architecture matched the product requirements better than the built-in Gateway ACP bridge.
