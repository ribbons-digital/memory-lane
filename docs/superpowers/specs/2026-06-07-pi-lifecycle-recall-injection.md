# pi Lifecycle Recall Injection Design

## Goal

Give pi/pi-mono sessions read-only lifecycle recall using pi's documented extension API and the shared `@memory-lane/lifecycle` memory injection policy.

This slice intentionally does not add automatic pi memory writes. pi autosave and tool-outcome capture remain deferred to the roadmap's later "pi Lifecycle Autosave and Tool Capture" phase.

## Background

Memory Lane already supports manual pi usage through `@memory-lane/pi-adapter`:

- `memory_save`
- `memory_suggest`
- `memory_recall`
- `/memory ...` commands

Codex and Claude Code use lifecycle adapters that call `@memory-lane/lifecycle` for automatic recall and save behavior. pi currently has a separate lightweight `input` classifier for explicit-ish memory saves, but it does not use the shared lifecycle recall path.

pi's extension documentation identifies `before_agent_start` as the event fired after user prompt submission and before the agent loop. That event can return a custom message:

```ts
return {
  message: {
    customType: "my-extension",
    content: "Additional context for the LLM",
    display: true,
  },
}
```

This event is the correct first integration point for read-only memory recall.

## Scope

### In scope

1. Add `@memory-lane/lifecycle` as a dependency of `@memory-lane/pi-adapter`.
2. In the pi adapter, subscribe to `before_agent_start`.
3. For each user prompt, call:
   ```ts
   handleUserPromptSubmit(engine, { cwd, prompt, sessionId })
   ```
   using the current pi `ctx.cwd` and `event.prompt`.
4. If `additionalContext` is returned, inject it with pi's documented custom-message response shape.
5. Keep existing pi commands and tools working unchanged.
6. Add tests for the adapter-level event behavior.
7. Update README and skill docs to explain pi lifecycle recall support and the autosave boundary.

### Out of scope

1. No pi automatic stop/autosave memory writes.
2. No pi `tool_result` / post-tool-use memory writes.
3. No pi hook debug JSONL logging.
4. No changes to Codex or Claude adapters.
5. No changes to lifecycle ranking, budget, or rendering policy.
6. No Obsidian behavior changes.

## Architecture

`@memory-lane/pi-adapter` remains the pi-specific extension package. It will use pi's documented extension events and delegate memory selection/rendering to `@memory-lane/lifecycle`.

The event flow is:

1. User submits a prompt in pi.
2. pi emits `before_agent_start` with the raw prompt text after input/template/skill processing.
3. Memory Lane resolves the existing engine for `ctx.cwd` using the adapter's current storage rules.
4. The adapter calls `handleUserPromptSubmit`.
5. `@memory-lane/lifecycle` performs recall, selection, filtering, and rendering.
6. If relevant memory exists, the adapter returns a custom message to pi.
7. If no relevant memory exists, the adapter returns nothing.

## Injection Format

Use pi's documented custom-message return from `before_agent_start`:

```ts
return {
  message: {
    customType: "memory-lane",
    content: additionalContext,
    display: false,
    details: {
      source: "memory-lane",
      lifecycleEvent: "user_prompt_submit",
    },
  },
}
```

Use `display: false` for low-noise operation. The message is still returned through pi's documented injected persistent-message path and is intended for model context, not user-visible chat transcript noise. Tests must assert the returned extension response shape; manual smoke can validate end-to-end pi behavior after implementation.

## Session Identity

When a pi session id is available from `ctx.sessionManager`, pass it as `sessionId`. If the API does not expose a stable id in the adapter's current shim, omit it. This field is optional in lifecycle input and should not block recall.

Do not parse pi session JSONL files in this slice.

## Error Handling

The lifecycle recall path must not interrupt the user's prompt.

If storage resolution, recall, semantic provider calls, or injection rendering fails:

1. Swallow the error for the agent flow.
2. Notify the user with the existing storage guidance only for storage access failures where the existing adapter already does so.
3. Return nothing from `before_agent_start` so pi continues normally.

The adapter must not prompt from this event.

## Existing pi `input` Handler

The current `pi.on("input")` handler remains unchanged in this slice. It can continue handling explicit save-like user input. The new `before_agent_start` recall path is read-only and must not duplicate save behavior.

A later phase will reassess whether pi's `input` save behavior should move to shared lifecycle autosave.

## Testing Requirements

Add adapter tests for:

1. Registering a `before_agent_start` handler when the extension loads.
2. Returning no injected message when lifecycle recall returns no `additionalContext`.
3. Returning a `memory-lane` custom message when relevant approved memory exists.
4. Ensuring the injected message content uses the shared lifecycle rendered block, including the `## Relevant Memory` heading.
5. Ensuring no memory is saved during recall injection.
6. Preserving existing tool/command registration behavior.

Tests must use temporary `MEMORY_LANE_*` or `PI_MEMORY_*` paths and must not write to the user's real `~/.memory-lane` store.

## Documentation Requirements

Update:

- `README.md`
- `skills/memory-lane/SKILL.md`

Docs must state:

1. pi supports manual Memory Lane tools/commands.
2. pi lifecycle recall injection is read-only and runs before the agent starts.
3. pi autosave and tool-outcome capture are not included yet.
4. Codex and Claude Code hook behavior remains separate.

## Acceptance Criteria

1. `@memory-lane/pi-adapter` builds with `@memory-lane/lifecycle` as a workspace dependency.
2. pi `before_agent_start` recall injection works through the documented extension response shape.
3. No pi automatic memory writes are introduced by this slice.
4. Existing pi tools and commands still register and behave as before.
5. New tests fail before implementation and pass after implementation.
6. `pnpm build` passes.
7. `pnpm test` passes.
8. Docs accurately describe the pi support boundary.
