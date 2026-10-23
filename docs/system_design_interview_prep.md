# Orbyt — System Design Interview Prep

> Complete reference: design patterns, SOLID principles, architecture, features built/not built, and diagrams.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Request Flow Diagram](#3-request-flow-diagram)
4. [SOLID Principles — Every Instance](#4-solid-principles--every-instance)
5. [Design Patterns — Every Instance](#5-design-patterns--every-instance)
6. [Data Model](#6-data-model)
7. [Features Built](#7-features-built)
8. [Features NOT Built (yet)](#8-features-not-built-yet)
9. [Tech Stack](#9-tech-stack)
10. [How to Explain It in an Interview](#10-how-to-explain-it-in-an-interview)

---

## 1. Project Overview

**Orbyt** is a self-hosted LLM API gateway — essentially a lighter version of OpenRouter.  
It sits between your application and multiple AI providers (Google, OpenAI, Anthropic, etc.) and gives you a single unified endpoint:

```
POST /v1/chat/completions
```

That one endpoint can automatically:
- Route to the cheapest, fastest, or most reliable provider
- Fall back to a different model if the first fails
- Retry on transient errors with exponential backoff
- Track every attempt in real-time telemetry

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MONOREPO (Turborepo)                         │
│                                                                     │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────────────┐  │
│  │  Dashboard   │   │  Primary Backend │   │    API Gateway     │  │
│  │  (Next.js)   │   │   (Express)      │   │    (Express)       │  │
│  │  :3000       │   │   :4000          │   │    :3001           │  │
│  │              │   │                  │   │                    │  │
│  │ • API Keys   │   │ • Auth (Clerk)   │   │ • LLM Routing      │  │
│  │ • Usage      │   │ • Key CRUD       │   │ • Provider Select  │  │
│  │ • Settings   │   │ • User Sync      │   │ • Retry Logic      │  │
│  │ • Credits    │   │ • BYOK mgmt      │   │ • Error Recovery   │  │
│  └──────┬───────┘   └───────┬──────────┘   └────────┬───────────┘  │
│         │                   │                        │              │
│         └───────────────────┴────────────────────────┘             │
│                             │                                       │
│              ┌──────────────┴──────────────┐                        │
│              │      Shared Packages         │                        │
│              │  @repo/db  @repo/types       │                        │
│              │  @repo/config  @repo/utils   │                        │
│              └─────────────────────────────┘                        │
│                                                                     │
│  ┌──────────────┐   ┌──────────────────┐                            │
│  │   DevTools   │   │      Docs        │                            │
│  │  (Next.js)   │   │  (Fumadocs)      │                            │
│  │  :4983       │   │  :3002           │                            │
│  │              │   │                  │                            │
│  │ • Live Runs  │   │ • API Reference  │                            │
│  │ • Traces     │   │ • Guides         │                            │
│  └──────────────┘   └──────────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴──────────┐
                    │   PostgreSQL (Neon) │
                    └────────────────────┘
```

### Microservices at a glance

| Service | Port | Role |
|---|---|---|
| `api-gateway` | 3001 | Receives LLM requests, routes to providers |
| `primary-backend` | 4000 | Auth, API key CRUD, user management |
| `dashboard` | 3000 | Web UI for users to manage keys & see usage |
| `devtools` | 4983 | Real-time telemetry visualiser |
| `docs` | 3002 | Developer documentation site |

---

## 3. Request Flow Diagram

```
Client App
    │
    │  POST /v1/chat/completions
    │  Authorization: Bearer sk-or-v1-xxxx
    ▼
┌──────────────────────────────────────────────────────┐
│                   API Gateway                         │
│                                                      │
│  ① apiKeyGate Middleware                             │
│     • SHA-256 hash the token                         │
│     • Query DB for matching key                      │
│     • Check isActive flag                            │
│     • Attach user + key info to req object           │
│     • Call next()                                    │
│                                                      │
│  ② LLMRouter.callLlm()                               │
│     │                                                │
│     ├─ Create TelemetryCollector (UUID run)          │
│     │                                                │
│     ├─ For each MODEL in fallback chain:             │
│     │    │                                           │
│     │    ├─ Look up model config (model-provider.ts) │
│     │    │                                           │
│     │    ├─ getProviderStrategy() → sort providers   │
│     │    │    cheap | fast | throughput | auto        │
│     │    │                                           │
│     │    └─ For each PROVIDER in sorted list:        │
│     │         │                                      │
│     │         ├─ MessageTransformer (if enabled)     │
│     │         │                                      │
│     │         └─ executeWithRetry()                  │
│     │              │                                 │
│     │              ├─ attempt 1 → call provider      │
│     │              │    SUCCESS → return response    │
│     │              │    FAIL    → classifyError()    │
│     │              │               │                 │
│     │              │               ├─ FIX_USER  → 4xx│
│     │              │               ├─ FIX_DEV   → 5xx│
│     │              │               ├─ RETRY     → ↓  │
│     │              │               └─ FALLBACK  → ↓↓ │
│     │              │                                 │
│     │              ├─ attempt 2 → exponential backoff│
│     │              └─ attempt 3 → FALLBACK_PROVIDER  │
│     │                                                │
│     └─ All models exhausted → throw error            │
│                                                      │
│  ③ TelemetryCollector.completeRun()                  │
│  ④ notifyDevtools() → SSE push to DevTools           │
└──────────────────────────────────────────────────────┘
    │
    ▼
AI Provider (e.g. Google Gemini)
```

---

## 4. SOLID Principles — Every Instance

### S — Single Responsibility Principle

> **Rule:** A class or module should have exactly ONE reason to change.

Every file in the `api-gateway` has a single, laser-focused job:

| File | Single Responsibility |
|---|---|
| [`llm-router.ts`](../apps/api-gateway/src/router/llm-router.ts) | Orchestrates the model/provider fallback loop only |
| [`provider-strategy.ts`](../apps/api-gateway/src/router/provider-strategy.ts) | Sorts providers by strategy — nothing else |
| [`decision-engine.ts`](../apps/api-gateway/src/router/decision-engine.ts) | Maps an error → a recovery action — nothing else |
| [`retry-handler.ts`](../apps/api-gateway/src/router/retry-handler.ts) | Computes backoff delays and sleep — nothing else |
| [`classifier.ts`](../apps/api-gateway/src/errors/classifier.ts) | Classifies raw errors into named error strings |
| [`buckets.ts`](../apps/api-gateway/src/errors/buckets.ts) | Defines which errors belong to which bucket |
| [`collector.ts`](../apps/api-gateway/src/telemetry/collector.ts) | Tracks run/step state — nothing else |
| [`notifier.ts`](../apps/api-gateway/src/telemetry/notifier.ts) | Sends a POST to DevTools — nothing else |
| [`message-transformer.ts`](../apps/api-gateway/src/transform/message-transformer.ts) | Compresses messages to fit context windows |
| [`apiKeyGate.ts`](../apps/api-gateway/src/middleware/apiKeyGate.ts) | Authenticates API key on every request |
| [`apikey.controller.ts`](../apps/primary-backend/src/controllers/apikey.controller.ts) | CRUD operations for platform API keys |

**How to explain it:**  
> "We applied SRP by splitting the routing logic into five separate files. The router doesn't know how to classify errors — that's the classifier's job. The classifier doesn't know when to retry — that's the decision engine's job. This means if we change our retry strategy, we only touch one file."

---

### O — Open/Closed Principle

> **Rule:** Software should be open for extension, closed for modification.

**Where we use it: the `AIProvider` interface**

```typescript
// apps/api-gateway/src/providers/gemini-provider.ts

export interface AIProvider {
  providerName: string;
  generateChat(modelSlug: string, messages: ChatMessage[], options: any, apiKey: string): Promise<any>;
}

export class GeminiProvider implements AIProvider { ... }
```

To add a new provider (OpenAI, Anthropic, Bedrock), you:
1. Create a new class that implements `AIProvider`
2. Register it in `LLMRouter`'s constructor map

You never touch the routing loop, the retry logic, or the error handling. They stay closed.

**Also in error buckets:**  
[`buckets.ts`](../apps/api-gateway/src/errors/buckets.ts) uses `Set` objects:

```typescript
export const RETRY_ERRORS = new Set([
  "RateLimitError", "ConnectionError", "TimeoutError", ...
]);
```

To add a new error type, you just add it to the right Set. The `resolveBucket()` function never changes.

**How to explain it:**  
> "The provider interface is the clearest OCP example. The LLMRouter loop just calls `providerInstance.generateChat()`. It has no idea whether it's talking to Gemini or GPT-4. Adding a new provider is purely additive — we never modify the existing routing code."

---

### L — Liskov Substitution Principle

> **Rule:** Any subtype must be substitutable for its base type without breaking the program.

In `llm-router.ts`:

```typescript
private providers: Map<string, AIProvider>;

// Called on every request:
const providerInstance = this.providers.get(providerMeta.provider);
const result = await providerInstance.generateChat(modelName, messages, options, apiKey);
```

Whether `providerInstance` is a `GeminiProvider`, a future `OpenAIProvider`, or an `AnthropicProvider`, the exact same call works. No `if (provider === "google")` branching anywhere in the router.

**How to explain it:**  
> "Because every provider satisfies the same `AIProvider` contract, the router can swap them out transparently. If we replaced `GeminiProvider` with an `OpenAIProvider`, the router wouldn't know or care — that's Liskov in action."

---

### I — Interface Segregation Principle

> **Rule:** Clients should not be forced to depend on interfaces they don't use. Keep interfaces small and focused.

The `AIProvider` interface has exactly two members:

```typescript
export interface AIProvider {
  providerName: string;
  generateChat(...): Promise<any>;
}
```

Providers don't implement streaming methods they don't support, or image methods, or fine-tuning methods. Each interface is minimal — just what the caller actually needs.

Similarly, `NormalizedChatRequest` in [`request.ts`](../packages/types/src/request.ts) only contains fields that the router actually reads. Nothing bloated.

**How to explain it:**  
> "We kept interfaces thin. A provider only has to implement `generateChat`. It's not forced to also implement streaming, embeddings, or fine-tuning just because we might need those later. That's ISP — clients only depend on what they actually use."

---

### D — Dependency Inversion Principle

> **Rule:** High-level modules should depend on abstractions, not on concrete implementations.

`LLMRouter` stores its providers as `Map<string, AIProvider>` — not `Map<string, GeminiProvider>`:

```typescript
// apps/api-gateway/src/router/llm-router.ts

private providers: Map<string, AIProvider>;  // ← abstraction

constructor(retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY) {
  this.providers = new Map();
  this.providers.set("google", new GeminiProvider());   // ← concrete at construction only
  this.retryHandler = new RetryHandler(retryPolicy);    // ← policy injected
}
```

The `RetryPolicy` is also injected, not hardcoded — the caller can override it with a custom policy:

```typescript
// DEFAULT_RETRY_POLICY is the abstraction; real values are injected
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 400,
  backoff: 2,
  maxDelayMs: 4000,
};
```

**How to explain it:**  
> "The router depends on the `AIProvider` interface, not on Gemini specifically. The retry policy is injected through the constructor instead of hardcoded inside the class. This is textbook DIP — details depend on abstractions, not the other way around."

---

## 5. Design Patterns — Every Instance

### Pattern 1: Strategy Pattern

**What it is:** Define a family of algorithms, encapsulate each one, and make them interchangeable at runtime.

**Where:** [`provider-strategy.ts`](../apps/api-gateway/src/router/provider-strategy.ts)

```typescript
export function getProviderStrategy(modelConfig: ModelConfig, type: string) {
  const providers = [...modelConfig.providers];

  if (type === "cheap") {
    return providers.sort((a, b) => a.cost.input + a.cost.output - (b.cost.input + b.cost.output));
  } else if (type === "fast") {
    return providers.sort((a, b) => a.metrics.latency - b.metrics.latency);
  } else if (type === "throughput") {
    return providers.sort((a, b) => b.metrics.throughput - a.metrics.throughput);
  } else {
    // auto: balanced score
    return providers.sort(
      (a, b) => b.metrics.reliability * 0.5 - (b.cost.input + b.cost.output)
               - (a.metrics.reliability * 0.5 - (a.cost.input + a.cost.output))
    );
  }
}
```

```
                    ┌─────────────────────┐
                    │   getProvider       │
                    │   Strategy(type)    │
                    └──────────┬──────────┘
                               │
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
    ┌─────────────┐   ┌───────────────┐   ┌──────────────┐   ┌──────────┐
    │   "cheap"   │   │   "fast"      │   │ "throughput"  │   │  "auto"  │
    │  sort by    │   │  sort by      │   │  sort by      │   │ balanced │
    │  cost asc   │   │  latency asc  │   │  tput desc    │   │  score   │
    └─────────────┘   └───────────────┘   └──────────────┘   └──────────┘
```

**How to explain it:**  
> "The Strategy Pattern lets us swap the provider-ordering algorithm at runtime based on what the user requests. The caller passes a string like `'cheap'` and gets back a sorted list of providers — the routing loop doesn't know or care which algorithm ran."

---

### Pattern 2: Chain of Responsibility

**What it is:** Pass a request along a chain of handlers; each handler decides to handle it or pass it along.

**Where:** [`llm-router.ts`](../apps/api-gateway/src/router/llm-router.ts) — the nested for-loops form the chain.

```
Request arrives
     │
     ▼
 Model 1 (primary)
     │
     ├─ Provider A → attempt 1 → FAIL (retry)
     │                attempt 2 → FAIL (retry)
     │                attempt 3 → FAIL (fallback_provider) ──┐
     │                                                        │
     └─ Provider B ◄──────────────────────────────────────────┘
           │
           ├─ attempt 1 → FAIL (fallback_provider) ──────────┐
           │                                                  │
           └─ exhausted ──────────────────────────────────────┤
                                                              │
 Model 2 (fallback) ◄─────────────────────────────────────────┘
     │
     ├─ Provider A → attempt 1 → SUCCESS → return ✓
     │
     └─ ...

All models exhausted → throw "All models and providers failed"
```

**Three levels in the chain:**
1. **Retry handler** — retries same provider up to `maxAttempts` times
2. **Provider fallback** — moves to next provider for same model
3. **Model fallback** — moves to next model in the `model_slug` array

**How to explain it:**  
> "The fallback logic is a Chain of Responsibility. Each 'handler' is a provider attempt. If it fails, it decides whether to retry (same handler again), fall back to the next provider (next handler in the chain), or bail out entirely. The chain terminates as soon as any handler returns success."

---

### Pattern 3: Command Pattern (via Enum)

**What it is:** Encapsulate a decision as an object/value that can be passed around and acted on later.

**Where:** [`decision-engine.ts`](../apps/api-gateway/src/router/decision-engine.ts)

```typescript
export enum RouterAction {
  RETRY,
  FALLBACK_PROVIDER,
  FAIL_USER,
  FAIL_DEV,
}

export function decide(error: any, attempt: number, maxAttempts: number): RouterAction {
  const { bucket } = classifyErrorUniversal(error);

  if (bucket === DecisionBucket.FIX_USER)  return RouterAction.FAIL_USER;
  if (bucket === DecisionBucket.FIX_DEV)   return RouterAction.FAIL_DEV;
  if (bucket === DecisionBucket.RETRY) {
    const isLast = attempt >= maxAttempts - 1;
    return isLast ? RouterAction.FALLBACK_PROVIDER : RouterAction.RETRY;
  }
  return RouterAction.FALLBACK_PROVIDER;
}
```

The action is a value, not a function call — the router receives the enum and decides what to do with it.

```
          Error
            │
            ▼
     classifyError()
            │
    ┌───────┴────────┐
    │                │
 FIX_USER        FIX_DEV
    │                │
 FAIL_USER       FAIL_DEV
                       │
                    RETRY
                       │
             ┌─────────┴──────────┐
         not last attempt     last attempt
             │                    │
           RETRY          FALLBACK_PROVIDER
```

**How to explain it:**  
> "The Decision Engine separates the question of 'what happened?' from 'what should we do about it?' The `decide()` function returns a `RouterAction` enum value. The caller then switches on that value. This makes the decision logic completely testable in isolation."

---

### Pattern 4: Singleton Pattern

**What it is:** Ensure a class has only one instance and provide a global access point to it.

**Where: Prisma Client** — [`packages/db/src/client.ts`](../packages/db/src/client.ts)

```typescript
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;   // ← cache on global to survive hot reloads
}
```

**Why:** Next.js hot-reload in dev mode would create a new `PrismaClient` on every file change, exhausting the database connection pool. The singleton prevents that.

**Also:**  
- [`llm-router.ts`](../apps/api-gateway/src/router/llm-router.ts) line 198: `export const llmRouter = new LLMRouter();`  
- [`message-transformer.ts`](../apps/api-gateway/src/transform/message-transformer.ts) line 47: `export const messageTransformer = new MessageTransformer();`

**How to explain it:**  
> "The Prisma client is a Singleton stored on `globalThis`. Without this, every hot-reload in development creates a fresh database connection pool until you hit the connection limit. The pattern ensures one instance is shared across the whole process."

---

### Pattern 5: Adapter Pattern

**What it is:** Convert the interface of one class into the interface another class expects. Allows incompatible interfaces to work together.

**Where:** [`gemini-provider.ts`](../apps/api-gateway/src/providers/gemini-provider.ts)

```
Our System expects                    Google Gemini SDK provides
──────────────────                    ──────────────────────────
generateChat(                         client.models.generateContent({
  modelSlug,                            model: ...,
  messages: ChatMessage[],   ──────►    contents: userText,
  options,                              config: { systemInstruction }
  apiKey                              })
): Promise<string>           ◄──────  response.text
```

The `GeminiProvider` class is the **Adapter** — it translates our OpenAI-style interface (`messages` array with roles) into what Gemini's SDK actually accepts.

**How to explain it:**  
> "Every AI provider has a different SDK and a different request format. We use the Adapter pattern to wrap each provider so they all look identical to the router. The router just calls `generateChat()` — the Adapter handles the translation internally."

---

### Pattern 6: Factory Pattern

**What it is:** A factory method creates objects without specifying the exact class to be instantiated.

**Where:** [`logger.ts`](../packages/utils/src/logger.ts)

```typescript
export class Logger {
  constructor(context: string, minLevel: LogLevel = "info") { ... }
  debug, info, warn, error methods...
}

// Factory function — caller doesn't call `new Logger()` directly
export function createLogger(context: string, minLevel?: LogLevel): Logger {
  return new Logger(context, minLevel);
}
```

The factory centralises construction: if you need to add a file transport or remote logging later, you change `createLogger` in one place — not every call site.

**How to explain it:**  
> "The Logger factory decouples object creation from usage. Every service calls `createLogger('MyContext')` instead of `new Logger(...)`. If we ever need to swap the logger implementation, we change the factory, not 50 call sites."

---

### Pattern 7: Observer Pattern (via Server-Sent Events)

**What it is:** Define a one-to-many dependency so that when one object changes state, all dependents are notified automatically.

**Publisher:** [`notifier.ts`](../apps/api-gateway/src/telemetry/notifier.ts)  
**Subscriber:** [`hooks.ts`](../apps/devtools/lib/hooks.ts) in DevTools

```
API Gateway                          DevTools UI
──────────                           ────────────
Each LLM step:                       useRuns() hook:
  collector.save()                     const eventSource = new EventSource("/api/events");
  notifyDevtools() ──── POST ──────►   eventSource.onmessage = (event) => {
                                         if (data.type === "update") fetchRuns();
                                       }
```

```
                     ┌─────────────────────┐
                     │    API Gateway       │
                     │  (Publisher/Subject) │
                     └──────────┬──────────┘
                                │  HTTP POST /api/notify
                                ▼
                     ┌─────────────────────┐
                     │   DevTools SSE      │
                     │   /api/events       │
                     └──────────┬──────────┘
                                │  SSE stream "update"
                    ┌───────────┴──────────────┐
                    ▼                           ▼
           ┌──────────────┐          ┌──────────────────┐
           │  Browser Tab │          │  Browser Tab     │
           │  (Observer)  │          │  (Observer)      │
           └──────────────┘          └──────────────────┘
```

**How to explain it:**  
> "The API Gateway notifies DevTools after every telemetry update using a simple HTTP POST. DevTools keeps an SSE connection open to the browser. When the POST arrives, DevTools broadcasts an 'update' event to all connected browser clients, which re-fetch the latest runs. That's the Observer pattern — the gateway doesn't know or care how many tabs are watching."

---

### Pattern 8: Middleware / Chain of Interceptors

**What it is:** A pipeline of handlers that process a request sequentially. Each handler can terminate the pipeline or pass control to the next.

**Where:** Express middleware chain in `api-gateway`

```
Incoming HTTP Request
        │
        ▼
 express.json()          ← parse body
        │
        ▼
  apiKeyGate()           ← authenticate + attach user to req
        │
        ▼
 handleChatCompletions() ← actual business logic
        │
        ▼
  HTTP Response
```

**Also in `primary-backend`:**

```
        │
        ▼
  clerkMiddleware()   ← verify Clerk session token
        │
        ▼
  rateLimitMiddleware() ← per-IP rate limiting
        │
        ▼
  loggingMiddleware()   ← log the request
        │
        ▼
  routeHandler()
```

**How to explain it:**  
> "Express middleware is a textbook Chain of Interceptors. Each middleware either calls `next()` to pass control down the chain, or returns a response to short-circuit it. The `apiKeyGate` middleware is the guard — if the key is invalid, the chain stops right there and returns a 401."

---

### Pattern 9: Repository Pattern

**What it is:** Abstract the data access layer behind a clean interface so business logic doesn't depend on how data is stored.

**Where:** Every controller in `primary-backend` uses Prisma as the repository:

```typescript
// apps/primary-backend/src/controllers/apikey.controller.ts

// Create
const apiKey = await prisma.platformUserApiKey.create({ data: { ... } });

// Read
const keys = await prisma.platformUserApiKey.findMany({ where: { userId: user.id } });

// Update
const updated = await prisma.platformUserApiKey.update({ where: { id }, data: { ... } });

// Delete
await prisma.platformUserApiKey.delete({ where: { id } });
```

The controller never writes raw SQL. If we swap Postgres for a different database, only the Prisma schema changes — the controller code stays identical.

**How to explain it:**  
> "Prisma acts as our Repository layer. Controllers call `prisma.platformUserApiKey.findMany()` — they don't know or care whether that's Postgres, SQLite, or something else. The data access is fully abstracted."

---

### Pattern 10: Decorator Pattern (via Middleware augmentation)

**What it is:** Add behaviour to an object dynamically by wrapping it — without modifying the original.

**Where:** `apiKeyGate` middleware decorates the Express `Request` object:

```typescript
// Before apiKeyGate: req has no user info
// After apiKeyGate:  req is decorated with:

req.apiKey = {
  id, userId, name,
  rateLimitRPM, rateLimitTPM,
  budgetLimit, creditsUsed, isActive
};

req.user = {
  id, clerkUserId
};
```

The downstream handler receives an enriched `req` with all auth context attached — without it needing to do a database lookup itself.

**How to explain it:**  
> "The `apiKeyGate` middleware decorates the request object with authenticated user and key metadata. The route handler just reads `req.user.id` — it doesn't know a database was hit to get that. The decorator pattern lets us layer functionality onto objects without modifying the original class."

---

### Pattern 11: Template Method (Error Classification Pipeline)

**What it is:** Define the skeleton of an algorithm in a base function, deferring specific steps to sub-functions.

**Where:** [`classifier.ts`](../apps/api-gateway/src/errors/classifier.ts)

```
classifyErrorUniversal(err)         ← Template: defines the 3-step pipeline
         │
    ┌────┴──────────────────────────────┐
    │ Step 1: check HTTP status code    │  STATUS_ERROR_MAP.get(status)
    │ Step 2: check error.name/.code    │  err.name || err.code
    │ Step 3: message heuristic scan    │  heuristicErrorName(err.message)
    └───────────────────────────────────┘
         │
         ▼
   resolveBucket(errorName)          ← maps name → DecisionBucket
```

Each step is a fallback for the previous — the algorithm's structure is fixed, but each step's logic is isolated in its own function.

**How to explain it:**  
> "The error classifier follows the Template Method pattern. The `classifyErrorUniversal` function defines a fixed 3-layer pipeline: first try the HTTP status code, then the error name, then heuristic message parsing. Each layer is a separate function. This makes each classification strategy independently testable."

---

## 6. Data Model

```
┌─────────────────────────────────────────────────────────────────┐
│                         DATABASE SCHEMA                          │
│                                                                 │
│  ┌──────────────────┐         ┌───────────────────────────┐    │
│  │       User       │         │   PlatformUserApiKey      │    │
│  ├──────────────────┤         ├───────────────────────────┤    │
│  │ id (PK)          │◄────────│ userId (FK)               │    │
│  │ clerkUserId      │         │ keyHash (SHA-256, unique)  │    │
│  │ username         │         │ key (masked display)       │    │
│  │ credits (BigInt) │         │ name                       │    │
│  │ createdAt        │         │ rateLimitRPM               │    │
│  └──────────────────┘         │ rateLimitTPM               │    │
│          │                    │ budgetLimit (BigInt)        │    │
│          │                    │ creditsUsed (BigInt)        │    │
│          │                    │ isActive                   │    │
│          │                    │ lastUsedAt                 │    │
│          │                    └───────────────────────────┘    │
│          │                                                      │
│          │    ┌──────────────────────────────────────┐         │
│          └───►│         Conversation                 │         │
│               ├──────────────────────────────────────┤         │
│               │ id (PK)                              │         │
│               │ userId (FK)                          │         │
│               │ apiKeyId (FK)                        │         │
│               │ input / output (text)                │         │
│               │ inputTokens / outputTokens           │         │
│               │ cost (BigInt micros)                 │         │
│               │ status                               │         │
│               └──────────────────┬───────────────────┘         │
│                                  │                             │
│                    ┌─────────────▼───────────────┐            │
│                    │           Trace              │            │
│                    ├─────────────────────────────┤            │
│                    │ id (PK)                      │            │
│                    │ conversationId (FK)          │            │
│                    │ step                         │            │
│                    │ metadata (JSON)              │            │
│                    └─────────────────────────────┘            │
│                                                                 │
│  ┌───────────────┐   ┌────────────────┐   ┌──────────────────┐ │
│  │   Provider    │   │     Model      │   │ModelProviderMap  │ │
│  ├───────────────┤   ├────────────────┤   ├──────────────────┤ │
│  │ id, name      │   │ id, name, slug │◄──│ modelId, provId  │ │
│  │ baseUrl       │◄──│                │   │ inputCost(BigInt)│ │
│  │ latencyScore  │   └────────────────┘   │ outputCost       │ │
│  │ reliabilScore │                        │ priority         │ │
│  └───────────────┘                        └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

Note: costs stored as BigInt micros (1 USD = 1,000,000 micros)
```

---

## 7. Features Built

### Core API Gateway
- [x] **Unified endpoint** — `POST /v1/chat/completions` (OpenAI-compatible format)
- [x] **Model fallback chain** — primary model → secondary → tertiary
- [x] **Provider selection strategies** — `cheap`, `fast`, `throughput`, `auto`
- [x] **Retry with exponential backoff** — 3 attempts, 400ms base, 2x multiplier, 200ms jitter
- [x] **Error classification** — 3-layer pipeline (HTTP status → error name → message heuristic)
- [x] **Smart error recovery** — route to user (4xx), crash for dev (5xx), retry, or fallback
- [x] **Message compression** — removes middle messages when over context limit
- [x] **BYOK** — users can supply their own provider API keys per-request
- [x] **Cost calculation** — BigInt precision, supports input/output/reasoning/cache tokens
- [x] **Multi-provider model registry** — 15+ models across Google, OpenAI, Anthropic, Groq, etc.

### Authentication & Key Management
- [x] **API key generation** — `sk-or-v1-` prefixed, 24 random bytes
- [x] **SHA-256 key hashing** — plaintext never stored in database
- [x] **Key masking** — display shows `sk-or-v1-xxxx...xxx`
- [x] **Key CRUD** — create, list, update (name/budget), toggle active, delete
- [x] **Rate limits per key** — configurable RPM and TPM at creation time
- [x] **Budget limits** — optional spending cap per key
- [x] **apiKeyGate middleware** — validates key, attaches user context to every request
- [x] **Clerk integration** — SSO for dashboard users

### Telemetry & Observability
- [x] **Run tracking** — UUID-based, persisted to `.devtools/generations.json`
- [x] **Step tracking** — each provider attempt is a step with timestamps, duration, status
- [x] **Real-time push** — API Gateway posts to DevTools after every save
- [x] **SSE stream** — DevTools broadcasts to browser via Server-Sent Events
- [x] **Live DevTools UI** — run list, step trace, connection status indicator

### Dashboard (Web UI)
- [x] **Landing page** — marketing site with feature overview
- [x] **API Keys page** — create/manage/delete keys with live table
- [x] **Usage page** — analytics placeholder
- [x] **Settings page** — user settings
- [x] **Clerk auth flow** — sign in, sign up, protected routes

### User Management (Primary Backend)
- [x] **User upsert** — create user on first Clerk sign-in
- [x] **Webhook receiver** — Clerk webhooks for user sync
- [x] **Credit system** — BigInt micros, 5,000,000 credits default
- [x] **BYOK key storage** — encrypted provider keys per user

### Infrastructure
- [x] **Turborepo monorepo** — shared packages, unified build pipeline
- [x] **Shared `@repo/types`** — TypeScript types shared across all apps
- [x] **Shared `@repo/config`** — model registry and provider config
- [x] **Shared `@repo/utils`** — logger, cost calculator, currency utils
- [x] **Shared `@repo/db`** — single Prisma client with Singleton pattern
- [x] **Prisma ORM** — type-safe queries, Neon serverless adapter
- [x] **Documentation site** — Fumadocs-powered with full API reference

---

## 8. Features NOT Built (yet)

### Provider Coverage
- [ ] **OpenAI provider** — interface exists, `openai` keys in registry, no SDK integration yet
- [ ] **Anthropic provider** — `anthropic` and `bedrock` in registry, no SDK integration
- [ ] **Groq provider** — in registry, not implemented
- [ ] **Mistral, Together, XAI providers** — in registry, not implemented
- [ ] **AWS Bedrock** — Claude via Bedrock is in the model config but not wired up

### API Gateway Features
- [ ] **Streaming support** — `streaming: true` exists in request schema but not implemented
- [ ] **Tool/function calling** — no passthrough of tool definitions
- [ ] **Multimodality** — no image/video/audio input support
- [ ] **Structured output / JSON mode** — not implemented
- [ ] **Embeddings endpoint** — no `/v1/embeddings`
- [ ] **Completions endpoint** — no `/v1/completions` (text-only, non-chat)
- [ ] **Prompt caching** — token-level cost tracked but caching not wired
- [ ] **Request deduplication** — no idempotency keys

### Rate Limiting & Billing
- [ ] **RPM/TPM enforcement** — limits stored in DB but not checked at gateway
- [ ] **Budget limit enforcement** — stored in DB but not checked per-request
- [ ] **Credit deduction on use** — credits exist but not decremented
- [ ] **Billing/payment integration** — no Stripe or payment processor

### Observability
- [ ] **Persistent telemetry in DB** — runs only in local file, not in Postgres `Trace` table
- [ ] **Dashboard usage charts** — page scaffolded but charts are empty
- [ ] **Cost per key over time** — tracking exists but no aggregation API
- [ ] **Log export / alerting** — no Datadog/Sentry integration

### Auth & Security
- [ ] **Auth middleware in primary-backend** — `auth.ts` file exists but implementation is a TODO
- [ ] **Rate-limit middleware in primary-backend** — scaffolded but not enforced
- [ ] **BYOK encryption** — field exists in schema but encryption-at-rest not implemented
- [ ] **IP allowlisting** — not implemented
- [ ] **JWT validation for API keys** — currently SHA-256 hash only

### Developer Experience
- [ ] **SDK clients** — no official JS/Python SDK
- [ ] **Playground** — no browser-based chat testing UI in dashboard
- [ ] **Webhook delivery** — no outbound webhooks for events

---

## 9. Tech Stack

```
Backend Services
├── Runtime:       Node.js 18+
├── Framework:     Express.js 5.x
├── Language:      TypeScript 5.9
├── ORM:           Prisma 7.7
├── Database:      PostgreSQL (Neon serverless)
├── Auth:          Clerk
└── AI SDKs:       @google/genai

Frontend (Dashboard & DevTools)
├── Framework:     Next.js 16.x
├── UI Library:    React 19
├── Styling:       Tailwind CSS 4
├── Components:    Shadcn/ui
├── State:         TanStack React Query 5
├── Charts:        Recharts
└── Auth:          @clerk/nextjs

Documentation
└── Framework:     Fumadocs

Build & Monorepo
├── Monorepo:      Turborepo 2.8
├── Package Mgr:   npm workspaces
├── TS Executor:   tsx
└── Formatter:     Prettier
```

---

## 10. How to Explain It in an Interview

### Opening statement (30 seconds)
> "This is a self-hosted LLM API gateway — think a simplified OpenRouter. You send one request to our endpoint with a list of models you want to try. We automatically route to the best provider based on your strategy — cheapest, fastest, or most reliable. If a provider fails, we retry with exponential backoff, then fall back to the next provider, then fall back to the next model. Everything is observed in real-time by a DevTools UI."

### On SOLID:
> "We applied all five SOLID principles. The strongest example is the provider system — the `AIProvider` interface is the heart of it. The router depends on the interface, not on any concrete provider. Adding a new provider requires zero changes to existing code — that's Open/Closed. Every concrete provider is substitutable in the map — that's Liskov. Each file has one job — classifier, decision engine, retry handler are all separate — that's Single Responsibility."

### On Design Patterns:
> "The most interesting pattern is the Chain of Responsibility for fallbacks. Each attempt is a link in the chain — it either succeeds and terminates the chain, or fails and passes control to the next link. The chain has three levels: retry the same provider, try the next provider for the same model, try the next model. Separately, the Strategy Pattern lets us swap the provider-ordering algorithm at runtime based on what the user wants."

### On the error system:
> "Error handling is often ad-hoc in projects. We built a proper classification system with three layers: check the HTTP status code first, then the error name, then do a message heuristic scan. The result goes to the Decision Engine which returns one of four actions: retry, fall back to the next provider, fail the user (their mistake), or crash for the developer (our bug). This separation means the recovery logic is completely testable in isolation."

### On the Singleton for Prisma:
> "We use the Singleton pattern for the Prisma client stored on `globalThis`. Without it, Next.js hot-reload in development creates a new database connection pool on every file save. You'd hit the connection limit almost immediately. The Singleton ensures one client is shared across the process lifecycle."

### On architecture:
> "It's a Turborepo monorepo with five apps: the API gateway, a primary backend for auth and key management, a dashboard frontend, a devtools frontend, and a docs site. Shared packages — types, config, utils, db — are consumed by all apps. This gives us strong typing across service boundaries and a single source of truth for things like the model registry and cost calculations."

---

*Document generated 2026-04-27 for system design interview preparation.*
